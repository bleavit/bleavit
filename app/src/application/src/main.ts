/**
 * The application entry — the side-effect module Vite builds, and nothing imports.
 *
 * It is deliberately three lines. Everything it would otherwise contain lives in
 * `boot.tsx`, because a module that touches `document` at import time cannot be imported by
 * a test, a tool, or another package — and `index.ts` re-exporting from here made the whole
 * package unimportable in Node until F7 tripped over it.
 *
 * `index.ts` does NOT re-export this file. That is the rule the split exists to keep.
 */

import { boot } from './boot.js';

const mount = document.getElementById('app');
if (mount) void boot(mount);
