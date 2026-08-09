import { create } from 'zustand';

/**
 * Session state: which scene, which scenario, where in it, and how to render.
 *
 * Protocol state does not live here. It is recomputed from the scenario's
 * declared steps by the pure reducer in `sim/engine.ts`, so the simulation stays
 * replayable and this store stays a thin cursor over it.
 */

export type SceneId =
  // The substrate: what makes this a Polkadot parachain at all.
  | 'the-chain'
  | 'the-upgrade'
  // One proposal, start to finish.
  | 'epoch-clock'
  | 'lifecycle'
  | 'market-floor'
  | 'ledger-escrow'
  | 'decide-gauntlet'
  | 'welfare-engine'
  | 'oracle-disputes'
  | 'execution-guard'
  // The edges: where the chain meets money, other chains, people and programs.
  | 'the-border'
  | 'the-service'
  | 'the-referees'
  | 'the-window';

export type ScenarioId =
  | 'normal-execution'
  | 'gate-failure'
  | 'oracle-dispute'
  | 'registry-dispute'
  | 'delayed-resolution'
  | 'blocked-execution';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface UiState {
  scene: SceneId;
  scenario: ScenarioId;
  /** Index into the active scenario's step list. */
  cursor: number;
  playing: boolean;
  /**
   * Whether the animated views open by default where a scene has one.
   *
   * A single preference rather than a render mode, because there is no longer a
   * mode to be in: the diagram is what every scene draws, and a motion is an
   * extra view that five of them offer. Turning this off means "do not start me
   * on the moving one", not "hide it".
   */
  motionEnabled: boolean;
  theme: ThemeMode;
  /** Set once the runtime decides a motion is not viable here, with the reason. */
  fallbackReason: string | null;
  sourcePanelOpen: boolean;

  setScene: (s: SceneId) => void;
  setScenario: (s: ScenarioId) => void;
  setCursor: (i: number) => void;
  step: (delta: number, max: number) => void;
  setPlaying: (p: boolean) => void;
  reset: () => void;
  setMotionEnabled: (on: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  setFallback: (reason: string | null) => void;
  setSourcePanel: (open: boolean) => void;
}

/**
 * Bumped when the shape changed: the old key stored a three-valued `renderMode`
 * for a renderer that no longer exists, and a stale `"2d"` in a returning
 * reader's storage would have silently pinned every scene away from the new
 * animated views. A rename would have left it readable; a new key does not.
 */
const PERSIST_KEY = 'bleavit-explainer:prefs.v2';

interface Prefs {
  motionEnabled: boolean;
  theme: ThemeMode;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { motionEnabled: true, theme: 'system' };
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const p = parsed as Partial<Prefs>;
    return {
      motionEnabled: typeof p.motionEnabled === 'boolean' ? p.motionEnabled : true,
      theme:
        p.theme === 'light' || p.theme === 'dark' || p.theme === 'system'
          ? p.theme
          : 'system',
    };
  } catch {
    // Storage is a convenience here and its loss must never be an error —
    // the same posture INV-FE-7 requires of the real client's local index.
    return fallback;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(p));
  } catch {
    /* ignore: preferences are best-effort */
  }
}

const initial = loadPrefs();

const SCENE_IDS: readonly SceneId[] = [
  'the-chain',
  'the-upgrade',
  'epoch-clock',
  'lifecycle',
  'market-floor',
  'ledger-escrow',
  'decide-gauntlet',
  'welfare-engine',
  'oracle-disputes',
  'execution-guard',
  'the-border',
  'the-service',
  'the-referees',
  'the-window',
];

/**
 * Resolve the opening scene from the URL, at store construction.
 *
 * Doing it here rather than in a mount effect is what makes a deep link work.
 * With the scene hardcoded, the first render committed `epoch-clock`, the
 * route-sync effect wrote that back over the hash, and `#/market-floor` in a
 * shared link silently became the front page — the two effects raced and the
 * wrong one won. Reading the hash before the first render removes the race
 * instead of ordering it, and it also removes the flash of the wrong scene.
 */
function sceneFromHash(): SceneId {
  if (typeof window === 'undefined') return 'the-chain';
  const id = window.location.hash.replace(/^#\/?/, '');
  return SCENE_IDS.find((s) => s === id) ?? 'the-chain';
}

export const useUi = create<UiState>((set, get) => ({
  scene: sceneFromHash(),
  scenario: 'normal-execution',
  cursor: 0,
  playing: false,
  motionEnabled: initial.motionEnabled,
  theme: initial.theme,
  fallbackReason: null,
  sourcePanelOpen: false,

  setScene: (scene) => set({ scene }),
  setScenario: (scenario) => set({ scenario, cursor: 0, playing: false }),
  setCursor: (cursor) => set({ cursor }),
  step: (delta, max) =>
    set((s) => ({ cursor: Math.min(Math.max(s.cursor + delta, 0), max) })),
  setPlaying: (playing) => set({ playing }),
  reset: () => set({ cursor: 0, playing: false }),

  setMotionEnabled: (motionEnabled) => {
    set({ motionEnabled, fallbackReason: null });
    savePrefs({ motionEnabled, theme: get().theme });
  },
  setTheme: (theme) => {
    set({ theme });
    savePrefs({ motionEnabled: get().motionEnabled, theme });
  },
  setFallback: (fallbackReason) => set({ fallbackReason }),
  setSourcePanel: (sourcePanelOpen) => set({ sourcePanelOpen }),
}));
