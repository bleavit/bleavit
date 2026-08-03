/**
 * The 10 §3.1 boot machine, checked against **the diagram in the specification**.
 *
 * The spec ships the machine as a mermaid `stateDiagram-v2`. This suite parses that
 * diagram out of `docs/architecture/10-frontend-architecture.md` and asserts the
 * reducer's reachable edge set equals it, in both directions. So the diagram is not
 * documentation of the code and the code is not an interpretation of the diagram — they
 * are one artifact with two renderings, and drift is a test failure rather than a
 * discrepancy nobody re-reads. (Same method as `reference-model/lifecycle.py`, which
 * parses 05 §2.2's diagram to check its own edge-set claim.)
 *
 * The machine matters precisely because its states are the ones that only occur when
 * something is broken: no peers on first load, IndexedDB refused, a worker the CSP would
 * not spawn. The reviewed machine lacked states for three of its own error codes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  INITIAL_SESSION,
  RENDERING_STATES,
  TERMINAL_STATES,
  reduce,
  signingEnabled,
  transitionEdges,
} from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read the spec in place — never a copy under `app/`.
const DOC = resolve(HERE, '..', '..', '..', 'docs', 'architecture', '10-frontend-architecture.md');

/** Extract the §3.1 `stateDiagram-v2` edges, ignoring the `[*]` pseudo-states. */
function diagramEdges() {
  const text = readFileSync(DOC, 'utf8');
  const block = text.match(/```mermaid\nstateDiagram-v2\n([\s\S]*?)```/);
  assert.ok(block, '10 §3.1 no longer contains a mermaid stateDiagram-v2 — this suite would be vacuous');
  const edges = new Set();
  for (const line of block[1].split('\n')) {
    const m = line.trim().match(/^(\S+)\s*-->\s*([^:]+?)\s*(?::.*)?$/);
    if (!m) continue;
    const [, from, to] = m;
    if (from === '[*]' || to === '[*]') continue; // entry/exit pseudo-states
    edges.add(`${from}>${to}`);
  }
  assert.ok(edges.size > 15, `parsed only ${edges.size} edges — the parser has stopped matching`);
  return edges;
}

const SPEC = diagramEdges();
const CODE = new Set(transitionEdges().map(([f, t]) => `${f}>${t}`));

test('the reducer takes exactly the edges 10 §3.1 draws', () => {
  const missing = [...SPEC].filter((e) => !CODE.has(e)).sort();
  const extra = [...CODE].filter((e) => !SPEC.has(e)).sort();
  assert.deepEqual(missing, [], 'edges in the spec diagram the reducer cannot take');
  assert.deepEqual(extra, [], 'edges the reducer can take that the spec diagram does not draw');
});

test('the three non-terminal error codes each reach a recoverable state', () => {
  // The reviewed machine lacked states for these; 10 §3.1 added them.
  let s = reduce(INITIAL_SESSION, { type: 'shell-parsed' });

  // FE-BOOT-001: storage failure is non-terminal and affects no protocol function.
  const memoryOnly = reduce(s, { type: 'storage-failed' });
  assert.equal(memoryOnly.state, 'WorkerSpawn');
  assert.equal(memoryOnly.memoryOnly, true);
  assert.equal(memoryOnly.lastError, 'FE-BOOT-001');

  // FE-BOOT-002 and FE-BOOT-004 are retryable.
  s = reduce(s, { type: 'storage-open' });
  const workerFailed = reduce(s, { type: 'worker-failed' });
  assert.equal(workerFailed.state, 'WorkerFailed');
  assert.equal(reduce(workerFailed, { type: 'user-retry' }).state, 'WorkerSpawn');

  const wasmFailed = reduce(reduce(s, { type: 'worker-up' }), { type: 'wasm-failed' });
  assert.equal(wasmFailed.state, 'WasmFailed');
  assert.equal(reduce(wasmFailed, { type: 'user-retry' }).state, 'WorkerSpawn');
});

test('a genesis mismatch is terminal, with no override (FE-BOOT-003)', () => {
  const wrong = reduce({ ...INITIAL_SESSION, state: 'IdentityCheck' }, { type: 'genesis-mismatch' });
  assert.equal(wrong.state, 'WrongChain');
  assert.ok(TERMINAL_STATES.has('WrongChain'));
  // Every event must leave it there. 10 §3.1: "mismatch (FE-BOOT-003, terminal)", no override.
  for (const type of ['user-retry', 'peer-acquired', 'genesis-matches', 'newer-release-loaded']) {
    assert.equal(reduce(wrong, { type }).state, 'WrongChain', `${type} escaped WrongChain`);
  }
});

test('the compat classifier is a lattice: partial pass boots into restricted', () => {
  const at = { ...INITIAL_SESSION, state: 'CompatCheck' };
  // It does not claim Ready and fail lazily (10 §3.1, §5.2).
  assert.equal(reduce(at, { type: 'compat-classified', mode: 'full' }).state, 'Ready');
  assert.equal(reduce(at, { type: 'compat-classified', mode: 'restricted' }).state, 'ReadyRestricted');
  assert.equal(
    reduce(at, { type: 'compat-classified', mode: 'read-only-incompatible' }).state,
    'ReadOnlyIncompatible',
  );
});

test('pre-Ready peer loss is a state, not a silent stall', () => {
  // Previously the machine could only degrade *after* Ready, leaving the most common
  // real-world failure — cannot reach peers on first load — stateless (10 §3.1).
  for (const state of ['RelaySyncing', 'ParaSyncing']) {
    const degraded = reduce({ ...INITIAL_SESSION, state }, { type: 'peers-lost' });
    assert.equal(degraded.state, 'SyncDegraded', `${state} did not degrade`);
    // Resync restarts at the relay: the parachain client cannot run without it.
    assert.equal(reduce(degraded, { type: 'peer-acquired' }).state, 'RelaySyncing');
  }
});

test('signing is unavailable wherever no verified read can exist', () => {
  const sign = (patch) => signingEnabled({ ...INITIAL_SESSION, ...patch });
  assert.equal(sign({ state: 'Ready' }), true);
  assert.equal(sign({ state: 'ReadyRestricted' }), true);
  assert.equal(sign({ state: 'Degraded' }), true, 'health is orthogonal to compat (10 §3.2)');
  assert.equal(sign({ state: 'WorkerFailed' }), false);
  assert.equal(sign({ state: 'WasmFailed' }), false);
  assert.equal(sign({ state: 'ReadOnlyIncompatible' }), false);
  assert.equal(sign({ state: 'ShellLoaded' }), false);
  // §2.2: normal-mode signing is disabled in RPC-only operation, in every state.
  assert.equal(sign({ state: 'Ready', rpcOnly: true }), false);
});

test('MemoryOnly is a flag, not a state, and survives the rest of boot', () => {
  // Modelling it as a state would multiply the machine by the storage mode and lose the
  // property that storage failure affects no protocol function (10 §3.1, §3.2).
  let s = reduce(INITIAL_SESSION, { type: 'shell-parsed' });
  s = reduce(s, { type: 'storage-failed' });
  for (const type of ['worker-up', 'relay-added', 'relay-finality-verified', 'first-finalized-para-head', 'genesis-matches']) {
    s = reduce(s, { type });
  }
  s = reduce(s, { type: 'compat-classified', mode: 'full' });
  assert.equal(s.state, 'Ready');
  assert.equal(s.memoryOnly, true, 'the storage flag was lost during boot');
  assert.equal(signingEnabled(s), true, 'storage failure must not disable signing');
});

test('an out-of-order event is a no-op, never a crash and never a new edge', () => {
  // A machine that threw would turn a recoverable race into a blank page; one with a
  // catch-all default would silently acquire transitions the diagram does not draw.
  const s = { ...INITIAL_SESSION, state: 'RelaySyncing' };
  for (const type of ['shell-parsed', 'storage-open', 'worker-up', 'genesis-matches', 'user-retry']) {
    assert.equal(reduce(s, { type }).state, 'RelaySyncing', `${type} produced an undrawn edge`);
  }
});

test('every non-terminal state can still reach a rendering state', () => {
  // Anti-vacuity for the edge comparison: an edge set can match the diagram and still
  // strand a state if the diagram itself were mis-transcribed into an island.
  const adjacency = new Map();
  for (const [from, to] of transitionEdges()) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  const reaches = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (RENDERING_STATES.has(node)) return true;
      for (const next of adjacency.get(node) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  };
  const stranded = [...new Set(transitionEdges().flat())]
    .filter((s) => !TERMINAL_STATES.has(s) && !reaches(s))
    .sort();
  assert.deepEqual(stranded, [], 'states from which no rendering surface is reachable');
});
