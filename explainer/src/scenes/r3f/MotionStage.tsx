import { Canvas } from '@react-three/fiber';
import type { MotionSpec } from '../motion';
import { motionReadout } from '../motion';
import { ContextLossGuard, RateGuard } from './kit';
import { TurningClock } from './motions/TurningClock';
import { CostSurface } from './motions/CostSurface';
import { BothFutures } from './motions/BothFutures';
import { Corridor } from './motions/Corridor';
import { Cliff } from './motions/Cliff';

/**
 * The one place three.js is mounted.
 *
 * Everything here — this file, `kit.tsx`, `motions/*` and the whole
 * three/fiber/drei tree — sits behind a single dynamic `import()` in
 * `SceneFrame`, so a visitor who never opens a motion never downloads a byte of
 * it. ESLint keeps that boundary real rather than customary: nothing under
 * `src/scenes/` outside this directory may import three.
 *
 * `frameloop` is `"always"` and that is the point of the rewrite. The previous
 * renderer ran on demand because nothing in it moved, which is exactly why it
 * added nothing to the flat diagram it was mirroring. These five all move, and
 * each one moves because a static frame of it would not carry the relation it
 * exists to show.
 */

function Motion({ spec }: { spec: MotionSpec }) {
  switch (spec.kind) {
    case 'turning-clock':
      return <TurningClock {...spec.props} />;
    case 'cost-surface':
      return <CostSurface {...spec.props} />;
    case 'both-futures':
      return <BothFutures {...spec.props} />;
    case 'corridor':
      return <Corridor {...spec.props} />;
    case 'cliff':
      return <Cliff {...spec.props} />;
  }
}

export interface MotionStageProps {
  spec: MotionSpec;
  onDegrade: (reason: string) => void;
}

export function MotionStage({ spec, onDegrade }: MotionStageProps) {
  const readout = motionReadout(spec);

  return (
    <>
      <Canvas
        className="stage__canvas"
        frameloop="always"
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0);
        }}
        // The canvas carries no fact that the readout below and the scene's own
        // data panel do not also carry, in text.
        aria-hidden="true"
        tabIndex={-1}
        role="presentation"
      >
        <RateGuard onDegrade={onDegrade} />
        <ContextLossGuard onDegrade={onDegrade} />
        <Motion spec={spec} />
      </Canvas>

      {/* Real DOM, deliberately. A moving picture is a bad place to read a
          quantity off, and a screen reader cannot reach geometry at all. */}
      <div className="m3-readout">
        <b>{readout.title}</b>
        {readout.lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </>
  );
}
