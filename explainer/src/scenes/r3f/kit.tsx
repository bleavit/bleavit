import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { FrameRateWatch } from '../capability';

/**
 * The shared vocabulary every motion is built from.
 *
 * Five motions, one material language: matte Lambert surfaces, drawn edges, no
 * post-processing, no shadow maps, no PBR. The look is a technical instrument
 * that happens to move, not a product render — which is also the cheapest thing
 * a GPU can do, and these run at `frameloop="always"`.
 */

export interface Palette {
  ink: string;
  dim: string;
  line: string;
  accept: string;
  reject: string;
  alarm: string;
  judge: string;
  accent: string;
  surface: string;
  well: string;
  ground: string;
}

const FALLBACK: Palette = {
  ink: '#eef2ff',
  dim: '#6675ab',
  line: '#2b3868',
  accept: '#1fd9b4',
  reject: '#ff9f45',
  alarm: '#ff5c84',
  judge: '#a382ff',
  accent: '#3ba9ff',
  surface: '#121a38',
  well: '#1a2450',
  ground: '#0a0f24',
};

function readPalette(): Palette {
  if (typeof window === 'undefined') return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  // The scene accent is set on the app wrapper, not on the root, so it has to be
  // read from the element that actually carries it.
  const appEl = document.querySelector('.app');
  const a = appEl !== null ? getComputedStyle(appEl) : s;
  const v = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
  return {
    ink: v('--ink', FALLBACK.ink),
    dim: v('--ink-3', FALLBACK.dim),
    line: v('--line', FALLBACK.line),
    accept: v('--accept', FALLBACK.accept),
    reject: v('--reject', FALLBACK.reject),
    alarm: v('--alarm', FALLBACK.alarm),
    judge: v('--judge', FALLBACK.judge),
    accent: a.getPropertyValue('--accent').trim() || FALLBACK.accent,
    surface: v('--surface', FALLBACK.surface),
    well: v('--well', FALLBACK.well),
    ground: v('--ground', FALLBACK.ground),
  };
}

/**
 * Track the page's theme and the scene's accent rather than owning a second
 * palette. The canvas is transparent and lives inside the page's tone system, so
 * a theme flip has to reach the geometry or the stage stops matching the page it
 * sits in.
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(readPalette);
  useEffect(() => {
    const update = () => setPalette(readPalette());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const appEl = document.querySelector('.app');
    if (appEl !== null) mo.observe(appEl, { attributes: true, attributeFilter: ['style'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);
  return palette;
}

/**
 * Three lights, no shadow maps: a key from the upper left, a cool fill from
 * below-right so the underside of every solid stays readable, and a hemisphere
 * floor so nothing goes to pure black.
 */
export function Lights({ palette }: { palette: Palette }) {
  return (
    <>
      <hemisphereLight args={[palette.surface, palette.ground, 1.15]} />
      <directionalLight position={[-6, 9, 8]} intensity={1.45} castShadow={false} />
      <directionalLight position={[7, -5, 4]} intensity={0.5} castShadow={false} />
    </>
  );
}

/**
 * A running frame-rate watch that bails to the flat diagram if the motion cannot
 * hold a usable rate. Now that the loop runs continuously this reads real frames
 * rather than the gaps between idle redraws, which is what it was always meant
 * to measure.
 */
export function RateGuard({ onDegrade }: { onDegrade: (reason: string) => void }) {
  const watch = useRef(new FrameRateWatch());
  useFrame((state) => {
    if (watch.current.sample(state.clock.elapsedTime)) {
      onDegrade(
        'This device could not hold a smooth frame rate here, so the diagram is shown.',
      );
    }
  });
  return null;
}

/**
 * A lost WebGL context renders as a blank canvas, which is the one failure mode
 * worse than no canvas: it looks like missing data rather than a missing
 * renderer. Browsers drop contexts for reasons the page does not control — GPU
 * reset, backgrounding, exceeding the per-page context budget — so the honest
 * response is to fall back to the drawing that needs no GPU at all.
 */
export function ContextLossGuard({ onDegrade }: { onDegrade: (reason: string) => void }) {
  const { gl } = useThree();
  const leaving = useRef(false);
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      // A loss raised by our own teardown is not a degradation to report.
      if (leaving.current) return;
      onDegrade('The graphics context was lost, so the diagram is shown.');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      /*
       * Hand the context back, explicitly, on the way out.
       *
       * Browsers cap live WebGL contexts per page — commonly sixteen — and evict
       * the oldest when a new one is created. Every scene change and every
       * scenario step that moves the reader to a different scene mounts a fresh
       * canvas, so a reader walking the app at speed can exhaust the budget and
       * watch the browser reclaim the context out from under a scene that is
       * still on screen. Observed exactly that way: eight or nine scene changes
       * in, a perfectly healthy stage reported a lost context and fell back.
       *
       * Waiting for GC to return them is not a policy, it is a hope. Losing it
       * deliberately returns the slot in the same tick.
       */
      leaving.current = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.getContext().getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [gl, onDegrade]);
  return null;
}

/**
 * The reading position: turn the drawing, never the camera.
 *
 * The obvious way to rake a scene is to lift the camera and aim it back at the
 * middle, and it does not work here. A three camera looks down its own −Z
 * regardless of where it stands, drei's camera components take no target, and a
 * `lookAt` issued from a sibling component races the camera's own `makeDefault`
 * registration — the first build of this rendered a blank stage with all its
 * geometry sitting nine units below the frame, which is a failure that looks
 * exactly like "the scene is empty".
 *
 * So the camera stays axis-aligned and the object turns on the bench. Two
 * consequences make this the better model anyway. Screen space and world space
 * stay the same space, so `offset` is a nudge in the direction the reader sees
 * and the orthographic fit is solvable in closed form. And the lights are fixed
 * in the room rather than bolted to the object, so the key stays over the
 * reader's left shoulder at every angle instead of sweeping as things turn.
 *
 * `rotation={[tilt, spin, 0]}` composes, in three's default XYZ order, as spin
 * about Y and then tilt about X — a turntable, then a rake. That order is the
 * one that keeps a horizon horizontal; the reverse tips it.
 */
export function Raked({
  tilt,
  spin = 0,
  offset = [0, 0],
  children,
}: {
  /** Radians to tip the drawing towards the reader. 0 is a flat elevation. */
  tilt: number;
  /** Radians about the vertical, applied first. */
  spin?: number;
  /** Screen-space nudge, in world units: the centre of what is drawn. */
  offset?: readonly [number, number];
  children: React.ReactNode;
}) {
  return (
    <group position={[offset[0], offset[1], 0]}>
      <group rotation={[tilt, spin, 0]}>{children}</group>
    </group>
  );
}

/**
 * Fit an orthographic camera to a world-space box, every frame.
 *
 * A hand-tuned zoom is a promise that the canvas will always be a particular
 * size, and this canvas is a fluid column beside a scrolling rail. Cropping a
 * diagram is worse than shrinking it, because the reader cannot tell something
 * is missing — so the extent is solved rather than guessed.
 *
 * `pad` is world units of margin reserved for screen-space labels and for the
 * parts of a motion that swing outside its resting bounds.
 */
export function useFitZoom(worldWidth: number, worldHeight: number, pad = 0): number {
  const { size } = useThree();
  return useMemo(() => {
    const w = worldWidth + pad * 2;
    const h = worldHeight + pad * 2;
    if (w <= 0 || h <= 0) return 30;
    return Math.min(size.width / w, size.height / h);
  }, [worldWidth, worldHeight, pad, size.width, size.height]);
}

/**
 * A screen-space label.
 *
 * Deliberately DOM rather than geometry. Troika SDF text (drei's `<Text>`)
 * fetches a font over the network unless one is bundled, and this app must stay
 * self-contained; and a label that tilts and scales with its object is a reticle
 * that rotates with the barrel. Instruments do not do that.
 */
export function Tag({
  position,
  children,
  tone = 'ink',
}: {
  position: [number, number, number];
  children: string;
  tone?: 'ink' | 'accept' | 'reject' | 'alarm' | 'dim';
}) {
  return (
    <Html position={position} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <span className={`m3-tag m3-tag--${tone}`}>{children}</span>
    </Html>
  );
}

/**
 * A slow, bounded camera sway.
 *
 * Not decoration: an orthographic projection of a surface is genuinely ambiguous
 * about which way it bulges, and a few degrees of parallax resolves it the way a
 * still image cannot. Bounded to a narrow arc so the reading position stays a
 * reading position — this is a raked instrument panel that breathes, not an
 * orbit.
 */
export function useSway(amplitudeDeg: number, periodSeconds: number): React.RefObject<number> {
  const value = useRef(0);
  useFrame((state) => {
    value.current =
      ((amplitudeDeg * Math.PI) / 180) *
      Math.sin((state.clock.elapsedTime * Math.PI * 2) / periodSeconds);
  });
  return value;
}

/**
 * Ease a value towards a target at a frame-rate-independent rate.
 *
 * `rate` is the fraction of the remaining distance covered per second, so the
 * same call behaves identically at 30 and at 120 fps. Everything in these
 * motions that responds to a simulation step goes through this, which is what
 * keeps a step change from reading as a jump cut.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Reusable, so a per-frame lerp does not allocate a colour every frame. */
const SCRATCH_A = new THREE.Color();
const SCRATCH_B = new THREE.Color();

/** Blend two CSS colours in linear-ish space and return a hex string. */
export function mixColor(a: string, b: string, t: number): string {
  SCRATCH_A.set(a);
  SCRATCH_B.set(b);
  return `#${SCRATCH_A.lerp(SCRATCH_B, Math.min(1, Math.max(0, t))).getHexString()}`;
}
