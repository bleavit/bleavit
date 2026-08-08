import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { LegendEntry, SceneModel } from './model';
import type { MotionSpec } from './motion';
import { MOTION_META } from './motion';
import { Scene2D } from './Scene2D';
import { assessCapability, defaultsTo2d } from './capability';
import { useUi } from '../state/store';
import './scene.css';

/**
 * Hosts one scene: the diagram, and — where there is one — the motion.
 *
 * The two are no longer the same drawing. They used to be: both renderers
 * consumed one `SceneModel` under one orthographic projection, which made
 * "degrades to 2D" a build-time guarantee and made the 3D view a strictly worse
 * copy of the flat one. A reader who switched to it saw the same content with
 * fewer labels and a tilt.
 *
 * Now the flat diagram is *the* diagram — complete, labelled, and the fallback
 * for everything — and a motion is a separate, purpose-built visual that exists
 * only where a relation genuinely cannot survive being flattened. Five scenes
 * have one. Three do not, and offer no tab rather than a decorative one.
 *
 * The DOM stays authoritative in the structural sense: the canvas is
 * `aria-hidden`, the motion's numbers are printed underneath it as text, and the
 * scene's data panel carries every fact either view shows.
 */

// The entire three/fiber/drei payload sits behind this boundary, so a visitor
// who never opens a motion never downloads it.
const MotionStage = lazy(async () => {
  const m = await import('./r3f/MotionStage');
  return { default: m.MotionStage };
});

/**
 * Catches a failure to load or mount the renderer and falls back to the diagram.
 *
 * The renderer arrives over a dynamic `import()`, and a dynamic import can fail
 * for reasons that have nothing to do with this app: a dropped connection
 * mid-fetch, a stale chunk hash after a redeploy, a corporate proxy. Without a
 * boundary that rejection propagates past `Suspense` — which only handles
 * pending, not failed — and unmounts the whole page to a white screen. Losing
 * the motion must cost the motion and nothing else.
 *
 * It has to be a class: `getDerivedStateFromError` has no hook equivalent.
 */
class RendererBoundary extends Component<
  { onError: (reason: string) => void; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError('The animated view could not be loaded, so the diagram is shown.');
    // Still surfaced, because a silent degradation hides real bugs from the
    // console of whoever is debugging this.
    console.error('[scene] motion renderer failed to load', error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useViewportWidth(): number {
  const [w, setW] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

const MARK_CLASS: Record<LegendEntry['mark'], string> = {
  ink: 'legend__mark--ink',
  dim: 'legend__mark--dim',
  accept: 'legend__mark--accept',
  reject: 'legend__mark--reject',
  alarm: 'legend__mark--alarm',
  hatch: 'legend__mark--hatch',
  frozen: 'legend__mark--frozen',
};

/**
 * The key, derived from what the drawing actually contains.
 *
 * A scene may declare its own `legend` when it has something specific to say.
 * When it does not, this pass reads the marks that are genuinely on the stage
 * and names them. Deriving beats declaring here for one reason: a hand-written
 * key drifts the moment a scene stops drawing something, and a key that names a
 * mark the reader cannot find is worse than no key at all.
 *
 * Only the marks with one fixed meaning across every scene are named. The
 * accent is not among them — it means "this scene's subject", which the scene
 * title already says better.
 */
function deriveLegend(model: SceneModel): readonly LegendEntry[] {
  if (model.legend !== undefined) return model.legend;

  const tones = new Set(model.nodes.map((n) => n.tone));
  const states = new Set(model.nodes.map((n) => n.state));
  const hatched = model.nodes.some((n) => n.hatched === true);

  const out: LegendEntry[] = [];
  if (tones.has('accept')) out.push({ mark: 'accept', label: 'If it passes' });
  if (tones.has('reject')) out.push({ mark: 'reject', label: 'If it is rejected' });
  if (tones.has('alarm')) out.push({ mark: 'alarm', label: 'Safety stop' });
  if (states.has('frozen')) out.push({ mark: 'frozen', label: 'Frozen — kept, not burned' });
  if (states.has('pending') || states.has('inactive')) {
    out.push({ mark: 'dim', label: 'Not reached yet' });
  }
  if (hatched) out.push({ mark: 'hatch', label: 'Invented for this example' });
  return out;
}

function Legend({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <ul className="legend">
      {entries.map((e) => (
        <li key={`${e.mark}-${e.label}`} className="legend__row">
          <span
            className={`legend__mark ${MARK_CLASS[e.mark]}${
              e.shape === 'chip' ? ' legend__mark--round' : ''
            }`}
            aria-hidden="true"
          />
          <span className="legend__label">{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface SceneFrameProps {
  model: SceneModel;
  /**
   * The animated view, when this scene has a relation that survives only in
   * three dimensions. Absent is the normal case and carries no apology: a state
   * graph, a timeline and a checklist are all *better* on a plane.
   */
  motion?: MotionSpec | undefined;
  /** Accessible name for the region. */
  title: string;
}

export function SceneFrame({ model, motion, title }: SceneFrameProps) {
  const width = useViewportWidth();
  const motionEnabled = useUi((s) => s.motionEnabled);
  const fallbackReason = useUi((s) => s.fallbackReason);
  const setFallback = useUi((s) => s.setFallback);

  /** null = follow the preference; otherwise this reader has chosen a tab. */
  const [choice, setChoice] = useState<'diagram' | 'motion' | null>(null);

  const capability = useMemo(() => assessCapability(width), [width]);
  const legend = useMemo(() => deriveLegend(model), [model]);

  // Moving to another scene mounts a fresh canvas, so a context lost on the
  // previous one is not evidence about this one. Without this, a single
  // transient loss anywhere pinned every remaining scene to the diagram for the
  // session. The tab choice resets with it: it was a choice about that scene.
  useEffect(() => {
    setFallback(null);
    setChoice(null);
    // Keyed on the scene's title, which is what actually changes between scenes;
    // the model object is rebuilt on every simulation step.
  }, [title, setFallback]);

  const available = motion !== undefined && capability.ok && fallbackReason === null;
  // Narrow viewports open on the diagram. The motion is still one tap away —
  // this is a default, not a lockout.
  const preferred = motionEnabled && !defaultsTo2d(width);
  const showMotion = available && (choice === null ? preferred : choice === 'motion');

  const meta = motion !== undefined ? MOTION_META[motion.kind] : null;

  /**
   * A degradation notice is shown only while the degradation is in force, and
   * only when it cost the reader something they asked for. Announcing "no WebGL"
   * on a scene that never had a motion would be noise about a thing that does
   * not exist.
   */
  const notice =
    motion !== undefined && !showMotion
      ? fallbackReason !== null
        ? fallbackReason
        : !capability.ok
          ? capability.reason
          : null
      : null;

  return (
    <section className="scene-region" aria-label={title}>
      {model.caption !== undefined ? (
        <p className="stage__caption">{model.caption}</p>
      ) : null}

      {motion !== undefined && meta !== null ? (
        <div className="stage__tabs" role="tablist" aria-label="How to view this">
          <button
            type="button"
            role="tab"
            className="vp-btn"
            aria-selected={!showMotion}
            onClick={() => setChoice('diagram')}
          >
            Diagram
          </button>
          {/* Asking for the motion clears a previous failure. A degradation is
              a report about one mount, not a verdict on the device — and a
              reader who clicks the tab after being told the context was lost is
              asking to try again, which is a request the button should be able
              to honour rather than a click on something disabled. */}
          <button
            type="button"
            role="tab"
            className="vp-btn"
            aria-selected={showMotion}
            disabled={!capability.ok}
            onClick={() => {
              setFallback(null);
              setChoice('motion');
            }}
          >
            {meta.label}
          </button>
        </div>
      ) : null}

      <div className={`stage${showMotion ? ' stage--motion' : ''}`}>
        {showMotion && motion !== undefined ? (
          <RendererBoundary onError={setFallback} fallback={<Scene2D model={model} />}>
            <Suspense fallback={<Scene2D model={model} />}>
              <MotionStage spec={motion} onDegrade={setFallback} />
            </Suspense>
          </RendererBoundary>
        ) : (
          <Scene2D model={model} />
        )}
      </div>

      {/* The notice sits below the stage, not over it. As an overlay it covered
          the bottom strip of every drawing — which is exactly where the label
          placement pass puts its lower bands, so the message explaining the
          fallback was hiding the fallback's own labels. */}
      {notice !== null ? <p className="stage__notice">{notice}</p> : null}

      {showMotion ? null : legend.length > 0 ? <Legend entries={legend} /> : null}

      {showMotion && meta !== null ? (
        <p className="scene__caption">
          <strong>Why this one moves:</strong> {meta.adds}
        </p>
      ) : model.relation !== '' ? (
        <p className="scene__caption">
          <strong>What the picture adds:</strong> {model.relation}
          {model.unitLegend !== undefined ? ` ${model.unitLegend}` : ''}
        </p>
      ) : null}
    </section>
  );
}
