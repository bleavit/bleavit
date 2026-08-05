/**
 * The one call to `react-dom/client` in the client.
 *
 * `ui` is already the only package permitted to name React (V-109 made the JSX runtime a
 * workspace specifier for the handoff unit's sake). Keeping the root creation here too
 * means the question *"what in this client can mount a React tree?"* is answered by
 * reading one package's dependency list, rather than by grepping for `createRoot` and
 * hoping the grep was exhaustive.
 *
 * `src/application` calls this and imports React nowhere.
 */

import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';

export function mount(container: Element, tree: ReactNode): () => void {
  const root = createRoot(container);
  root.render(tree);
  return () => root.unmount();
}
