/**
 * The development JSX runtime — the `react-jsxdev` counterpart of `jsx-runtime.ts`.
 *
 * The production build never reaches this file (`tsconfig.base.json` pins `react-jsx`, and
 * `vite build` is a production build). It ships anyway, because the alternative is an
 * `exports` map that resolves in one mode and not the other: a developer running the dev
 * server would hit a module-not-found on the first tag rendered, and the natural fix at
 * that moment — point `jsxImportSource` back at `react` — silently undoes V-109 for every
 * file in the repository.
 */

export { Fragment, jsxDEV } from 'react/jsx-dev-runtime';
export type { JSX } from 'react/jsx-dev-runtime';
