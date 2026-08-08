import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Testing Library registers its own `afterEach(cleanup)` only when Vitest runs
 * with `globals: true`. This project runs with `globals: false` — imports should
 * be explicit — so cleanup has to be wired by hand. Without it, renders
 * accumulate across cases in a file and queries start matching elements from a
 * previous test, which fails as "found multiple elements" and is easy to
 * misread as a bug in the component.
 */
afterEach(cleanup);

/**
 * jsdom has no canvas implementation, so it logs "Not implemented:
 * HTMLCanvasElement's getContext()" every time the WebGL capability probe runs.
 *
 * That probe returning nothing is the *expected* result under test — it is what
 * drives the 2D fallback path we want exercised. Silencing only that message
 * keeps a real failure visible while stopping a correct behaviour from filling
 * the output with noise.
 */
const ORIGINAL_ERROR = console.error;

console.error = (...args: unknown[]) => {
  const first = args[0];
  const text =
    typeof first === 'string'
      ? first
      : first instanceof Error
        ? first.message
        : '';
  if (text.includes("HTMLCanvasElement's getContext()")) return;
  ORIGINAL_ERROR(...args);
};
