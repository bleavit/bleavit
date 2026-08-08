import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { Group } from 'three';
import type { CliffProps } from '../../motion';
import { Lights, Raked, Tag, approach, mixColor, useFitZoom, usePalette } from '../kit';
import { gate } from '../../../protocol/welfare';

/**
 * Why one weak pillar is not a small deduction.
 *
 * The flat diagram gives the composition table — which components feed which
 * pillar, at what weight — and a table is the only sane way to read that. What a
 * table cannot show is the *shape* of the combination, and the shape is the
 * whole safety argument. `W` is a **product** of two gates, not a weighted
 * average of four pillars, and a product with a hard floor behaves nothing like
 * an average: below θ⁻ the gate is exactly zero, so a chain that is not surviving
 * cannot buy its score back with fee growth no matter how good the other numbers
 * get.
 *
 * Drawn over its two gated pillars, that is a plateau with a sheer drop on two
 * sides meeting at a corner. You do not have to be told a weak pillar is
 * catastrophic; you can see there is nothing under it.
 *
 * The surface is the certified `gate()` itself, evaluated per vertex — the same
 * grid-integer smoothstep the tests replay against the reference corpus, so the
 * knee is exactly as sharp as the specification makes it and not one pixel
 * sharper.
 */

const SEG = 72;
/** World units across the base plane, and up. Isotropic: this is a real plot. */
const PLAN = 8.6;
const RISE = 4.6;
/** How much dead floor to keep below the knee, so "exactly zero" is visible. */
const APRON = 0.14;
const TILT = 0.54;
/*
 * Turn the safe corner towards the reader.
 *
 * The plateau sits at high Survival *and* high Capability — the far corner from
 * the origin — and at the obvious viewing angle it hides at the back right with
 * both cliffs seen edge-on. Spinning it forward puts the reader at the foot of
 * the drop, looking up at the only region where the score is not zero, which is
 * the composition this shape is worth drawing for.
 */
const BASE_SPIN = -0.5;
/* Half the rise, so the plateau and the dead floor get equal room: framing on
   the floor alone would push the plateau off the top edge, and the plateau is
   the half that has to look safe. */
const OFFSET = [0, -0.4] as const;

interface Frame {
  lo: number;
  span: number;
  /** W at a point, in [0, plateau]. */
  w: (s: number, c: number) => number;
  /** Pillar value to world coordinate. */
  toWorld: (v: number) => number;
  /** W to world height. */
  toHeight: (w: number) => number;
}

function useFrameGeom(props: CliffProps): Frame {
  const { thetaS, thetaC, plateau } = props;
  return useMemo(() => {
    const lo = Math.max(0, Math.min(thetaS[0], thetaC[0]) - APRON);
    const span = Math.max(1e-6, 1 - lo);
    const safePlateau = Math.max(1e-6, plateau);
    const gs = (x: number) =>
      thetaS[1] > thetaS[0] ? gate(x, thetaS[0], thetaS[1]) : x >= thetaS[1] ? 1 : 0;
    const gc = (x: number) =>
      thetaC[1] > thetaC[0] ? gate(x, thetaC[0], thetaC[1]) : x >= thetaC[1] ? 1 : 0;
    return {
      lo,
      span,
      w: (s, c) => gs(s) * gc(c) * safePlateau,
      toWorld: (v) => ((v - lo) / span - 0.5) * PLAN,
      toHeight: (w) => (w / safePlateau) * RISE,
    };
  }, [thetaS, thetaC, plateau]);
}

function Surface({ frame, palette }: { frame: Frame; palette: ReturnType<typeof usePalette> }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(PLAN, PLAN, SEG, SEG);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const s = frame.lo + (pos.getX(i) / PLAN + 0.5) * frame.span;
      const c = frame.lo + (-pos.getY(i) / PLAN + 0.5) * frame.span;
      const w = frame.w(s, c);
      const h = frame.toHeight(w);
      pos.setZ(i, h);
      // A single-hue ramp on the scene's own accent. The reserved hues stay
      // reserved: nothing on this surface is a branch instrument or a safety
      // state, it is a score.
      col.set(mixColor(palette.well, palette.accent, h / RISE));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [frame, palette]);

  /** Contours at fixed fractions of the plateau: a proper surface plot. */
  const contours = useMemo(() => {
    const out: [number, number, number][][] = [];
    for (let k = 1; k <= 6; k++) {
      const at = frame.lo + (k / 7) * frame.span;
      const alongS: [number, number, number][] = [];
      const alongC: [number, number, number][] = [];
      for (let j = 0; j <= SEG; j++) {
        const v = frame.lo + (j / SEG) * frame.span;
        alongS.push([
          frame.toWorld(v),
          frame.toHeight(frame.w(v, at)) + 0.015,
          frame.toWorld(at),
        ]);
        alongC.push([
          frame.toWorld(at),
          frame.toHeight(frame.w(at, v)) + 0.015,
          frame.toWorld(v),
        ]);
      }
      out.push(alongS, alongC);
    }
    return out;
  }, [frame]);

  return (
    <group>
      <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.95} />
      </mesh>
      {contours.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color={palette.ink}
          lineWidth={0.8}
          transparent
          opacity={0.16}
        />
      ))}
    </group>
  );
}

/** The two edges the whole design exists to defend. */
function Edges2({
  frame,
  thetaS,
  thetaC,
  palette,
}: {
  frame: Frame;
  thetaS: readonly [number, number];
  thetaC: readonly [number, number];
  palette: ReturnType<typeof usePalette>;
}) {
  const build = (fixed: number, axis: 's' | 'c') => {
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= SEG; j++) {
      const v = frame.lo + (j / SEG) * frame.span;
      const [s, c] = axis === 's' ? [fixed, v] : [v, fixed];
      pts.push([frame.toWorld(s), frame.toHeight(frame.w(s, c)) + 0.05, frame.toWorld(c)]);
    }
    return pts;
  };
  return (
    <>
      <Line points={build(thetaS[0], 's')} color={palette.alarm} lineWidth={2.6} />
      <Line points={build(thetaC[0], 'c')} color={palette.alarm} lineWidth={2.6} />
    </>
  );
}

export function Cliff(props: CliffProps) {
  const { s, c, w, thetaS, thetaC } = props;
  const palette = usePalette();
  const frame = useFrameGeom(props);
  const zoom = useFitZoom(10.4, 9.6);
  const sway = useRef<Group>(null);
  const marker = useRef<Group>(null);

  useFrame((state, dt) => {
    if (sway.current !== null) {
      sway.current.rotation.y =
        BASE_SPIN + ((7 * Math.PI) / 180) * Math.sin(state.clock.elapsedTime * 0.3);
    }
    if (marker.current !== null) {
      marker.current.position.x = approach(marker.current.position.x, frame.toWorld(s), 4, dt);
      marker.current.position.z = approach(marker.current.position.z, frame.toWorld(c), 4, dt);
      marker.current.position.y = approach(marker.current.position.y, frame.toHeight(w), 4, dt);
    }
  });

  const overCliff = w <= 0;

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 0, 60]} zoom={zoom} near={-400} far={800} />
      <Lights palette={palette} />

      <Raked tilt={TILT} offset={OFFSET}>
        <group ref={sway}>
          <Surface frame={frame} palette={palette} />
          <Edges2 frame={frame} thetaS={thetaS} thetaC={thetaC} palette={palette} />

          {/* Where the chain is standing. The pin drops to the floor so the
            footprint is readable even when the score is zero. */}
          <group
            ref={marker}
            position={[frame.toWorld(s), frame.toHeight(w), frame.toWorld(c)]}
          >
            <mesh>
              <sphereGeometry args={[0.26, 20, 14]} />
              <meshLambertMaterial
                color={overCliff ? palette.alarm : palette.ink}
                emissive={overCliff ? palette.alarm : palette.ink}
                emissiveIntensity={0.25}
              />
            </mesh>
            <Line
              points={[
                [0, 0, 0],
                [0, -RISE - 0.4, 0],
              ]}
              color={overCliff ? palette.alarm : palette.ink}
              lineWidth={1.4}
              transparent
              opacity={0.6}
            />
          </group>

          {/* Both floors, named on the edges they belong to. The axes
              themselves carry no tag: the readout names the two pillars in
              full, and two more labels on a turning surface bought nothing but
              two more things to collide with. */}
          <Tag position={[frame.toWorld(thetaS[0]), 0.45, PLAN / 2 + 0.45]} tone="alarm">
            {`Survival floor ${thetaS[0].toFixed(2)}`}
          </Tag>
          <Tag position={[-PLAN / 2 - 0.45, 0.45, frame.toWorld(thetaC[0])]} tone="alarm">
            {`Capability floor ${thetaC[0].toFixed(2)}`}
          </Tag>
        </group>
      </Raked>
    </>
  );
}
