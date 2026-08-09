import { useMemo } from 'react';
import { useUi } from './store';
import { runScenario } from '../sim/engine';
import { SCENARIOS, SCENARIO_SUBJECT } from '../sim/scenarios';
import type { SimState } from '../sim/types';
import type { ProposalClass } from '../protocol/types';

/**
 * The world, replayed from the scenario's first step to the current cursor.
 *
 * This binding lives in `state/` rather than in `sim/` on purpose: `sim/` is
 * framework-free so the engine stays testable without a renderer, and ESLint
 * enforces that boundary. This is the only place React and the engine meet.
 *
 * Replay-from-zero rather than incremental mutation. It is cheap at this scale
 * and it makes scrubbing backwards correct by construction, instead of by
 * carefully written undo logic that has to be trusted.
 */
export function useSimulation(): SimState {
  const scenarioId = useUi((s) => s.scenario);
  const cursor = useUi((s) => s.cursor);

  return useMemo(() => {
    const scenario = SCENARIOS[scenarioId];
    const subject = SCENARIO_SUBJECT[scenarioId];
    return runScenario(scenario, cursor, subject.cls as ProposalClass, subject.title);
  }, [scenarioId, cursor]);
}
