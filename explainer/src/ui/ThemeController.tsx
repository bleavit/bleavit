import { useEffect } from 'react';
import { useUi } from '../state/store';

/**
 * Applies the theme to the document root.
 *
 * `system` removes the attribute entirely rather than resolving it, so the CSS
 * `prefers-color-scheme` branch stays in charge and the page follows the OS
 * without JavaScript having to observe it.
 */
export function ThemeController() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);
  return null;
}

export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const labels = { system: 'System', light: 'Light', dark: 'Dark' } as const;
  return (
    <button
      type="button"
      className="vp-btn"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${labels[theme]}. Activate for ${labels[next]}.`}
    >
      {labels[theme]}
    </button>
  );
}
