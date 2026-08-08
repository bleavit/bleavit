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
import { connectAndClassify } from './chain-boot.js';
import { handleTerminalBootFailure } from './wrong-chain.js';

const mount = document.getElementById('app');
// The chain connection is started **after** the tree is up, for the reason the release worker
// is registered after it (10 §3.2): the verification panel, the docs and the whole handoff
// surface render when smoldot never starts, so nothing that renders may wait on it.
//
// `connectAndClassify` rather than `connectChain`: 10 §3.1 puts `CompatCheck` between the
// first finalized head and every healthy terminal state, so a client that connected and never
// classified has skipped the state that decides whether it may sign. The verdict is not yet
// rendered — that needs the re-render path `boot.tsx` records as F7's remainder, and this
// build starts no chain to have a verdict about — so what this line buys today is that the
// classifier has a production caller and the whole path compiles as one piece.
//
// **The `.catch` is 10 §3.1's terminal state, not defensive habit.** F27 made
// `WrongChainError` propagate (SQ-1026 — PAPI's chain factory had been retrying it forever),
// and a propagating error with no handler is an unhandled rejection: the shell would keep
// rendering while the client had proved it is on the wrong chain. `handleTerminalBootFailure`
// re-throws anything else, so this stays one declared state's screen rather than the place
// boot failures go quiet.
if (mount) {
  void boot(mount)
    .then(connectAndClassify)
    .catch((error: unknown) => handleTerminalBootFailure(mount, error));
}
