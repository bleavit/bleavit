import { useEffect } from 'react';
import { useUi } from './state/store';
import { ThemeController } from './ui/ThemeController';
import { SourcePanel } from './ui/SourcePanel';
import { AppHeader } from './ui/AppHeader';
import { ScenarioTransport } from './ui/ScenarioTransport';
import { CHROME_VAR, SCENES, SCENES_BY_CHAPTER, SCENE_ORDER } from './scenes/registry';
import { useSimulation } from './state/useSimulation';
import './ui/app.css';

/** Hash routing: `#/<scene>`. No server, so no history-API rewrites. */
function useHashRoute() {
  const scene = useUi((s) => s.scene);
  const setScene = useUi((s) => s.setScene);

  useEffect(() => {
    const apply = () => {
      const id = window.location.hash.replace(/^#\/?/, '');
      if (SCENE_ORDER.includes(id as never)) setScene(id as never);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setScene]);

  useEffect(() => {
    const want = `#/${scene}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, [scene]);
}

export function App() {
  useHashRoute();
  const scene = useUi((s) => s.scene);
  const setScene = useUi((s) => s.setScene);
  const setSourcePanel = useUi((s) => s.setSourcePanel);
  const sim = useSimulation();

  const definition = SCENES[scene];
  const Scene = definition.Component;

  // Moving focus to the scene heading on change is what makes keyboard and
  // screen-reader navigation coherent across a single-page shell.
  useEffect(() => {
    const h = document.getElementById('scene-heading');
    h?.focus();
  }, [scene]);

  const index = SCENE_ORDER.indexOf(scene) + 1;

  return (
    // The scene's chrome hue is set once, here, on the element that wraps
    // everything: the header, the nav, the stage and the rail all inherit it, so
    // moving between scenes recolours the whole page in one assignment.
    <div className="app" style={{ ['--accent' as string]: CHROME_VAR[definition.chrome] }}>
      <ThemeController />
      <a className="skip-link" href="#scene-heading">
        Skip to the scene
      </a>

      <AppHeader sim={sim} />

      {/* Fourteen scenes in one flat row is a menu, not a route. Grouping them
          into three acts lets a reader skip a whole act deliberately: somebody
          who only wants the futarchy can start at "A proposal's life", and
          somebody integrating against the chain can go straight to "The edges".
          The running number stays global, because it is the wayfinding that
          pairs with the number printed beside the scene title. */}
      <nav className="scenenav" aria-label="Scenes">
        <div className="scenenav__inner">
          {SCENES_BY_CHAPTER.map(([chapter, ids]) => (
            <section key={chapter.id} className="scenenav__group">
              <h2 className="scenenav__grouptitle" title={chapter.blurb}>
                {chapter.title}
              </h2>
              <ul className="scenenav__list">
                {ids.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="scenenav__btn"
                      style={{ ['--accent' as string]: CHROME_VAR[SCENES[id].chrome] }}
                      aria-current={scene === id ? 'page' : undefined}
                      onClick={() => setScene(id)}
                    >
                      <span className="scenenav__idx mono">
                        {String(SCENE_ORDER.indexOf(id) + 1).padStart(2, '0')}
                      </span>
                      <span className="scenenav__name">{SCENES[id].navLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      <main id="main" className="app-main">
        <div className="grid21 scene-head">
          <div className="col-full scene-head__inner">
            {/* The number is the wayfinding: fourteen scenes, one machine, and
                the hue that goes with it repeats on the nav chip you came from. */}
            <span className="scene-head__idx" aria-hidden="true">
              {String(index).padStart(2, '0')}
            </span>
            <div className="scene-head__text">
              <h1 id="scene-heading" tabIndex={-1} className="scene-title">
                {definition.title}
              </h1>
              <p className="scene-tagline">{definition.tagline}</p>
            </div>
          </div>
        </div>
        <Scene sim={sim} />
      </main>

      <ScenarioTransport sim={sim} onExplainSource={() => setSourcePanel(true)} />
      <SourcePanel />
    </div>
  );
}
