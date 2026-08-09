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

/**
 * A mounted tree that can be re-rendered.
 *
 * `mount` returned an unmount handle and nothing else, so the shell could paint once and
 * never again — which is why 10 §3.2's compat mode, a **session-scoped variable** that
 * changes on every `CodeUpdated`, had nowhere to land. A React root already supports this:
 * `root.render` is idempotent and reconciles, so the second call is a re-render rather than
 * a second tree. What was missing was a caller holding the root.
 */
export interface MountedTree {
  /** Re-render into the same root. Safe to call any number of times before `unmount`. */
  readonly render: (tree: ReactNode) => void;
  /** Tear the tree down. React clears the container. */
  readonly unmount: () => void;
}

export function mountLive(container: Element, tree: ReactNode): MountedTree {
  const root = createRoot(container);
  root.render(tree);
  return {
    render: (next) => {
      root.render(next);
    },
    unmount: () => root.unmount(),
  };
}

/**
 * Mount once and hand back only the teardown.
 *
 * Kept as the narrow surface for callers that genuinely paint once — deleting it would
 * make every such caller hold a `render` it must not use, which is a wider capability
 * than the job needs.
 */
export function mount(container: Element, tree: ReactNode): () => void {
  return mountLive(container, tree).unmount;
}
