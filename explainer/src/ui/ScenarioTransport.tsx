import { useEffect } from 'react';
import { useUi } from '../state/store';
import { SCENARIOS, SCENARIO_ORDER } from '../sim/scenarios';
import type { SimState } from '../sim/types';
import { prefersReducedMotion } from '../scenes/capability';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * Scenario transport, and the standing simulated-data disclosure with it.
 *
 * The two used to be separate fixed bars stacked at the bottom edge, costing
 * 150px of every viewport and reading as two pieces of chrome competing for the
 * same attention. They are one bar now: the disclosure is a permanent,
 * non-dismissable chip on the same row as the controls. It is still always on
 * screen, which is the only property that actually mattered.
 *
 * Stepping is entirely button- and keyboard-driven, and each step announces its
 * narration through a live region — so the scenario is followable without ever
 * looking at a canvas. Auto-play is off by default and is suppressed entirely
 * under reduced motion, because an explainer that advances itself while you are
 * still reading is not an explainer.
 */
export function ScenarioTransport({
  sim,
  onExplainSource,
}: {
  sim: SimState;
  onExplainSource: () => void;
}) {
  const scenarioId = useUi((s) => s.scenario);
  const setScenario = useUi((s) => s.setScenario);
  const cursor = useUi((s) => s.cursor);
  const step = useUi((s) => s.step);
  const reset = useUi((s) => s.reset);
  const setScene = useUi((s) => s.setScene);

  const scenario = SCENARIOS[scenarioId];
  const max = scenario.steps.length;
  const current = cursor > 0 ? scenario.steps[cursor - 1] : undefined;

  // Follow the scenario's focus so the diagram matches the narration.
  useEffect(() => {
    if (current !== undefined) setScene(current.focus);
  }, [current, setScene]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'n') step(1, max);
      if (e.key === 'ArrowLeft' || e.key === 'p') step(-1, max);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, max]);

  const reduced = prefersReducedMotion();

  return (
    <div className="transport">
      <div className="transport__inner">
        <div className="transport__deck">
          <label className="sr-only" htmlFor="scenario-select">
            Scenario
          </label>
          <select
            id="scenario-select"
            className="transport__scenario"
            value={scenarioId}
            onChange={(e) => setScenario(e.target.value as typeof scenarioId)}
          >
            {SCENARIO_ORDER.map((id) => (
              <option key={id} value={id}>
                {SCENARIOS[id].title}
              </option>
            ))}
          </select>

          <div className="transport__buttons">
            <button
              type="button"
              className="tbtn"
              onClick={() => step(-1, max)}
              disabled={cursor === 0}
              aria-label="Previous step"
            >
              ←
            </button>
            <button
              type="button"
              className="tbtn tbtn--primary"
              onClick={() => step(1, max)}
              disabled={cursor >= max}
            >
              {cursor === 0 ? 'Start' : cursor >= max ? 'Done' : 'Next'} →
            </button>
            <button
              type="button"
              className="tbtn"
              onClick={reset}
              disabled={cursor === 0}
              aria-label="Reset scenario"
            >
              ↺
            </button>
          </div>

          {/* A dot per step: how far in you are, at a glance, without reading. */}
          <span className="transport__pips" aria-hidden="true">
            {scenario.steps.map((s, i) => (
              <span
                key={s.title}
                className={`transport__pip${i < cursor ? ' is-done' : ''}`}
              />
            ))}
          </span>
          <span className="transport__step mono">
            {cursor}/{max}
          </span>
        </div>

        <p className="transport__narration" aria-live="polite">
          {current === undefined ? (
            <>
              <strong>{scenario.title}.</strong> {scenario.premise}
            </>
          ) : (
            <>
              <strong>{current.title}.</strong> {sim.narration}
            </>
          )}
        </p>

        {/* The standing disclosure. Permanent, never dismissable. */}
        <button type="button" className="simchip" onClick={onExplainSource}>
          <ProvenanceBadge prov="simulated" />
          <span className="simchip__text">
            <strong>Simulated.</strong> Nothing here was read from a live chain.
          </span>
        </button>

        {reduced ? null : (
          <span className="sr-only">
            Use the left and right arrow keys to step through the scenario.
          </span>
        )}
      </div>
    </div>
  );
}
