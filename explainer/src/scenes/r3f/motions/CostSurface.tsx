import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { Group } from 'three';
import type { CostSurfaceProps } from '../../motion';
import { Lights, Raked, Tag, mixColor, useFitZoom, usePalette } from '../kit';
import { cost, priceLong } from '../../../protocol/lmsr';

/**
 * What a trade costs, as a landscape.
 *
 * This is the one relation in the app that a plane genuinely cannot hold. The
 * LMSR cost is a function of *two* quantities — how much LONG the book has sold
 * and how much SHORT — and a chart of one against the other has already spent
 * both of its axes before it can show the cost. Flattening it means picking a
 * slice and throwing the rest away.
 *
 * The surface is not an illustration of the formula, it is the formula: every
 * vertex height is a call to the same certified `cost()` the app's tests replay
 * against `reference-model/fixtures/vectors.json`, and every vertex colour is a
 * call to the same `priceLong()`. If the arithmetic were wrong the shape would be
 * wrong.
 *
 * Three things it makes visible at a glance:
 *
 *  - **The slope you are standing on is the price.** That is what the derivative
 *    of the cost function *is*, and on a surface a derivative is a slope you can
 *    see rather than a definition you have to accept.
 *  - **The diagonal is flat-rate.** Buying equal amounts of both sides climbs at
 *    exactly 1 per unit, forever: a complete set costs par, which is the fact the
 *    whole conditional ledger is built on.
 *  - **Everything here depends only on the current price.** Rescale by `b` and
 *    the landscape around the book is fixed by one number, which is why a market
 *    maker can quote from a single state variable.
 */

/** Half-window, in units of `b`. Past this the shape stops adding anything. */
const SPAN_B = 0.95;
/** World units per unit of `b`, applied to all three axes — an honest plot. */
const SCALE = 3.1;
/** Surface resolution. 56x56 is 3.1k verts: free, and smooth at any zoom. */
const SEG = 56;
/** Grid lines drawn on the surface, each way. */
const GRID_LINES = 9;
const TILT = 0.6;
/*
 * A three-quarter view, and two rejected alternatives.
 *
 * The cost surface is exactly linear along the diagonal — buying both sides
 * together climbs at a flat rate forever — and that ramp dominates the shape.
 * Viewed straight on, the ramp ran off the frame and the surface read as a
 * tilted plane sliding out of the picture. Viewed straight *down* the diagonal
 * the ramp is foreshortened away, and so is the surface: a ruled surface seen
 * along its own ruling projects to a single curve, and the stage showed a
 * hairline. What is left is the ordinary three-quarter angle every textbook
 * surface plot uses, which works here for the same reason it works there.
 */
const BASE_SPIN = 0.6;
const OFFSET = [0, -0.2] as const;

interface Field {
  /** Height in world units, at (x, z) in units of `b` relative to the book. */
  h: (x: number, z: number) => number;
  /** Long price at that point, in [0,1]. */
  p: (x: number, z: number) => number;
}

/**
 * Place the book at the inventory its quoted price implies.
 *
 * `p = 1 / (1 + e^{-(q_L - q_S)/b})` inverts to `q_L - q_S = b·ln(p / (1 - p))`,
 * and only that difference matters — the cost function is invariant to adding
 * the same amount to both sides. So one quote fixes the whole landscape, which
 * is the claim this motion is making and is also what keeps the surface and the
 * page's own price readout from ever disagreeing.
 */
function useField(b: number, spot: number): Field {
  return useMemo(() => {
    // Clamped off the endpoints: at p = 0 or 1 the logit is infinite, and a book
    // quoting a certainty has no landscape left to draw.
    const p = Math.min(0.995, Math.max(0.005, spot));
    const qLong = b * Math.log(p / (1 - p));
    const qShort = 0;
    const base = cost(b, qLong, qShort);
    return {
      h: (x, z) => ((cost(b, qLong + x * b, qShort + z * b) - base) / b) * SCALE,
      p: (x, z) => priceLong(b, qLong + x * b, qShort + z * b),
    };
  }, [b, spot]);
}

function Surface({ field, palette }: { field: Field; palette: ReturnType<typeof usePalette> }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(SPAN_B * 2 * SCALE, SPAN_B * 2 * SCALE, SEG, SEG);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / SCALE;
      // Plane-local +y becomes world −z once the mesh is laid down, so the SHORT
      // axis is negated here rather than in the reader's head.
      const z = -pos.getY(i) / SCALE;
      pos.setZ(i, field.h(x, z));
      c.set(mixColor(palette.reject, palette.accept, field.p(x, z)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [field, palette]);

  /**
   * Contour lines on the surface.
   *
   * A shaded surface under a single light is ambiguous about its own curvature —
   * the eye reads brightness as either slope or albedo. Ruled lines remove the
   * ambiguity, and they are also how anyone who has read a textbook plot expects
   * to be told "this is a function of two variables".
   */
  const rules = useMemo(() => {
    const out: [number, number, number][][] = [];
    const step = (SPAN_B * 2) / (GRID_LINES - 1);
    for (let i = 0; i < GRID_LINES; i++) {
      const at = -SPAN_B + i * step;
      const alongX: [number, number, number][] = [];
      const alongZ: [number, number, number][] = [];
      for (let j = 0; j <= SEG; j++) {
        const t = -SPAN_B + (j / SEG) * SPAN_B * 2;
        alongX.push([t * SCALE, field.h(t, at) + 0.02, at * SCALE]);
        alongZ.push([at * SCALE, field.h(at, t) + 0.02, t * SCALE]);
      }
      out.push(alongX, alongZ);
    }
    return out;
  }, [field]);

  return (
    <group>
      <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.94} />
      </mesh>
      {rules.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color={palette.ink}
          lineWidth={0.8}
          transparent
          opacity={0.14}
        />
      ))}
    </group>
  );
}

export function CostSurface({ b, spot }: CostSurfaceProps) {
  const palette = usePalette();
  const field = useField(b, spot);
  const zoom = useFitZoom(9.4, 9.8);
  const swayGroup = useRef<Group>(null);

  useFrame((state) => {
    if (swayGroup.current === null) return;
    // A bounded sway, not an orbit. Eight degrees is enough parallax to resolve
    // which way a surface bulges and little enough that the reading position
    // stays a reading position.
    swayGroup.current.rotation.y =
      BASE_SPIN + ((7 * Math.PI) / 180) * Math.sin(state.clock.elapsedTime * 0.32);
  });

  const p = field.p(0, 0);

  /** The diagonal: buying both sides at once, at flat rate. */
  const diagonal = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= 40; j++) {
      const t = -SPAN_B + (j / 40) * SPAN_B * 2;
      pts.push([t * SCALE, field.h(t, t) + 0.05, t * SCALE]);
    }
    return pts;
  }, [field]);

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 0, 60]} zoom={zoom} near={-400} far={800} />
      <Lights palette={palette} />

      <Raked tilt={TILT} offset={OFFSET}>
        <group ref={swayGroup}>
          <Surface field={field} palette={palette} />

          {/* The flat-rate line. A complete set costs par however far you walk. */}
          <Line
            points={diagonal}
            color={palette.ink}
            lineWidth={2}
            transparent
            opacity={0.75}
          />

          {/* Where the book is now: the origin of the landscape, by construction. */}
          <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.3, 28]} />
            <meshLambertMaterial color={palette.ink} />
          </mesh>
          <Line
            points={[
              [0, 0, 0],
              [0, -SPAN_B * SCALE, 0],
            ]}
            color={palette.ink}
            lineWidth={1.2}
            transparent
            opacity={0.45}
          />

          {/* The two axis walks, each labelled by the side it buys. Their slopes
            are the two prices, and the two slopes add to one. */}
          <Line
            points={[
              [0, field.h(0, 0) + 0.06, 0],
              [SPAN_B * SCALE, field.h(SPAN_B, 0) + 0.06, 0],
            ]}
            color={palette.accept}
            lineWidth={2.4}
          />
          <Line
            points={[
              [0, field.h(0, 0) + 0.06, 0],
              [0, field.h(0, SPAN_B) + 0.06, SPAN_B * SCALE],
            ]}
            color={palette.reject}
            lineWidth={2.4}
          />

          {/* Read off the surface rather than passed in, so it is the same number
            the geometry was built from. If the book's quoted price and this ever
            disagreed, they would disagree on screen. */}
          <Tag position={[0, 1.5, 0]}>{`YES ${(p * 100).toFixed(1)}%`}</Tag>

          <Tag position={[SPAN_B * SCALE + 1.1, field.h(SPAN_B, 0) + 0.4, 0]} tone="accept">
            buy YES
          </Tag>
          <Tag position={[0, field.h(0, SPAN_B) + 0.4, SPAN_B * SCALE + 1.1]} tone="reject">
            buy NO
          </Tag>
        </group>
      </Raked>
    </>
  );
}
