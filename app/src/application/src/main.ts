/**
 * The application entry — the side-effect module Vite builds, and nothing imports.
 *
 * It is deliberately two calls and no logic. Everything it would otherwise contain lives in
 * `boot.tsx` and `chain-boot.ts`, because a module that touches `document` at import time
 * cannot be imported by a test, a tool, or another package — and `index.ts` re-exporting from
 * here made the whole package unimportable in Node until F7 tripped over it.
 *
 * `index.ts` does NOT re-export this file. That is the rule the split exists to keep.
 */

import { boot } from './boot.js';
import { connectChain } from './chain-boot.js';

const mount = document.getElementById('app');
// The chain connection is started **after** the tree is up, for the reason the release worker
// is registered after it (10 §3.2): the verification panel, the docs and the whole handoff
// surface render when smoldot never starts, so nothing that renders may wait on it.
if (mount) void boot(mount).then(connectChain);
