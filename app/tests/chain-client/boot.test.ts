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
  rendersUsableSurface,
  signingEnabled,
  transitionEdges,
} from '@bleavit/chain-client';
import type { BootEvent, BootSession, BootState } from '@bleavit/chain-client';

/**
 * Every event that carries no payload beyond its name.
 *
 * Derived from `BootEvent` rather than listed, so the loops below narrow against the
 * machine's own vocabulary: an event renamed in `boot.ts` fails to compile here instead
 * of quietly becoming an unhandled `type` string that the reducer ignores — which is
 * exactly the "no-op, never a new edge" behaviour two of these tests assert, so a typo
 * would have *passed*.
 */
type PayloadFreeEvent = Exclude<BootEvent, { type: 'compat-classified' }>['type'];

/** A session parked in one state — where every transition test starts. */
const sessionAt = (state: BootState): BootSession => ({ ...INITIAL_SESSION, state });

const HERE = dirname(fileURLToPath(import.meta.url));
// Read the spec in place — never a copy under `app/`.
const DOC = resolve(HERE, '..', '..', '..', 'docs', 'architecture', '10-frontend-architecture.md');

/** Extract the §3.1 `stateDiagram-v2` edges, ignoring the `[*]` pseudo-states. */
function diagramEdges(): ReadonlySet<string> {
  const text = readFileSync(DOC, 'utf8');
  const block = text.match(/```mermaid\nstateDiagram-v2\n([\s\S]*?)```/);
  const body = block?.[1];
  assert.ok(body, '10 §3.1 no longer contains a mermaid stateDiagram-v2 — this suite would be vacuous');
  const edges = new Set<string>();
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^(\S+)\s*-->\s*([^:]+?)\s*(?::.*)?$/);
    if (m === null) continue;
    const [, from, to] = m;
    if (from === '[*]' || to === '[*]') continue; // entry/exit pseudo-states
    edges.add(`${from}>${to}`);
  }
  assert.ok(edges.size > 15, `parsed only ${edges.size} edges — the parser has stopped matching`);
  return edges;
}

/**
 * The one line of doc 10 containing `needle`, refusing if there is not exactly one.
 *
 * Zero matches is the vacuity case: the assertion below it then holds over nothing. Two is
 * worse — it silently picks the first, so an edit elsewhere changes which sentence binds.
 */
function theSpecLine(needle: string): string {
  const lines = readFileSync(DOC, 'utf8').split('\n').filter((line) => line.includes(needle));
  assert.equal(lines.length, 1, `expected exactly one line of doc 10 containing ${JSON.stringify(needle)}`);
  return lines[0] as string;
}

/** A real boot, driven event by event, parked at `CompatCheck` with the probe still out. */
function bootToCompatCheck(): BootSession {
  const path = [
    'shell-parsed', 'storage-open', 'worker-up', 'relay-added', 'relay-finality-verified',
    'first-finalized-para-head', 'genesis-matches',
  ] as const satisfies readonly PayloadFreeEvent[];
  let s = INITIAL_SESSION;
  for (const type of path) s = reduce(s, { type });
  assert.equal(s.state, 'CompatCheck', 'the boot path no longer reaches the compat probe');
  return s;
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
  const wrong = reduce(sessionAt('IdentityCheck'), { type: 'genesis-mismatch' });
  assert.equal(wrong.state, 'WrongChain');
  assert.ok(TERMINAL_STATES.has('WrongChain'));
  // Every event must leave it there. 10 §3.1: "mismatch (FE-BOOT-003, terminal)", no override.
  const escapes = ['user-retry', 'peer-acquired', 'genesis-matches', 'newer-release-loaded'] as const satisfies readonly PayloadFreeEvent[];
  for (const type of escapes) {
    assert.equal(reduce(wrong, { type }).state, 'WrongChain', `${type} escaped WrongChain`);
  }
});

test('the compat classifier is a lattice: partial pass boots into restricted', () => {
  const at = sessionAt('CompatCheck');
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
  const syncing = ['RelaySyncing', 'ParaSyncing'] as const satisfies readonly BootState[];
  for (const state of syncing) {
    const degraded = reduce(sessionAt(state), { type: 'peers-lost' });
    assert.equal(degraded.state, 'SyncDegraded', `${state} did not degrade`);
    // Resync restarts at the relay: the parachain client cannot run without it.
    assert.equal(reduce(degraded, { type: 'peer-acquired' }).state, 'RelaySyncing');
  }
});

test('signing is unavailable wherever no verified read can exist', () => {
  const sign = (patch: Partial<BootSession>): boolean => signingEnabled({ ...INITIAL_SESSION, ...patch });
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
  const boot = ['worker-up', 'relay-added', 'relay-finality-verified', 'first-finalized-para-head', 'genesis-matches'] as const satisfies readonly PayloadFreeEvent[];
  for (const type of boot) {
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
  const s = sessionAt('RelaySyncing');
  const outOfOrder = ['shell-parsed', 'storage-open', 'worker-up', 'genesis-matches', 'user-retry'] as const satisfies readonly PayloadFreeEvent[];
  for (const type of outOfOrder) {
    assert.equal(reduce(s, { type }).state, 'RelaySyncing', `${type} produced an undrawn edge`);
  }
});

test('every non-terminal state can still reach a rendering state', () => {
  // Anti-vacuity for the edge comparison: an edge set can match the diagram and still
  // strand a state if the diagram itself were mis-transcribed into an island.
  const adjacency = new Map<BootState, BootState[]>();
  for (const [from, to] of transitionEdges()) {
    const outgoing = adjacency.get(from) ?? [];
    outgoing.push(to);
    adjacency.set(from, outgoing);
  }
  const reaches = (start: BootState): boolean => {
    const seen = new Set<BootState>([start]);
    const queue: BootState[] = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
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

/* ---------------------------------------------- FE-COMPAT-003: the state that renders nothing
 *
 * The test above is reachability, and reachability is exactly what masked this. `CompatCheck`
 * can classify successfully, so a breadth-first walk out of `CompatUnavailable` reaches `Ready`
 * and reports the state healthy — while a user whose probe never completes sits in the
 * `CompatUnavailable` ⇄ `CompatCheck` cycle looking at nothing. A walk that passes *through* a
 * state on its way somewhere better cannot say whether the state itself renders, and this state
 * was added for precisely the person who never gets somewhere better.
 *
 * So the three tests below drive the cycle as a place to **live**, never as a place to pass.
 */

test('CompatUnavailable renders the surface 10 §3.1 hands it, not a blank screen', () => {
  const bullet = theSpecLine('**`CompatUnavailable`**');
  // §3.1 does not describe this state's surface, it *assigns* it another state's. The donor is
  // read out of the sentence rather than named here, so moving the surface moves the binding.
  const named = /renderable surface is `([A-Za-z]+)`'s/.exec(bullet);
  assert.ok(named, `10 §3.1 no longer assigns CompatUnavailable a renderable surface: ${bullet}`);
  const donor = named[1] as BootState;
  assert.ok(RENDERING_STATES.has(donor), `${donor} does not itself render — the sentence is being read wrong`);
  assert.ok(
    RENDERING_STATES.has('CompatUnavailable'),
    `10 §3.1 gives CompatUnavailable ${donor}'s renderable surface, and the machine renders nothing there`,
  );
});

test('a probe that keeps failing still renders — the cycle is where the session lives', () => {
  let s = reduce(bootToCompatCheck(), { type: 'compat-unavailable' });
  assert.equal(s.state, 'CompatUnavailable');

  const visited: BootState[] = [];
  const holds = (session: BootSession, note: string): void => {
    visited.push(session.state);
    assert.ok(rendersUsableSurface(session), `${session.state} renders nothing ${note}`);
    // The three properties §3.1 attaches to the outcome, checked wherever the cycle rests.
    assert.equal(signingEnabled(session), false, `${session.state} permitted signing ${note}`);
    assert.equal(session.compat, undefined, `${session.state} carried a mode nothing established ${note}`);
    assert.equal(session.lastError, 'FE-COMPAT-003', `${session.state} lost the stated reason ${note}`);
  };
  holds(s, 'on the first failure');

  // Ten probes, each one failing again. Nothing here ever classifies: a walk that ends at
  // `Ready` would prove nothing about the state it passed through, which is the whole finding.
  const cycle = ['compat-retry', 'compat-unavailable'] as const satisfies readonly PayloadFreeEvent[];
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    for (const type of cycle) {
      s = reduce(s, { type });
      holds(s, `on attempt ${attempt}`);
    }
  }
  // ...and the walk really did sit in the cycle rather than escaping it.
  assert.deepEqual([...new Set(visited)].sort(), ['CompatCheck', 'CompatUnavailable']);
});

test('the first CompatCheck is a probe in flight, and claims no surface', () => {
  // The control for the test above: `rendersUsableSurface` returning true everywhere satisfies
  // it. A first boot has shown nothing but the skeleton §3.1's diagram opens with, and 10 §3.1
  // assigns a renderable surface to `CompatUnavailable` and to nothing else on this path.
  const first = bootToCompatCheck();
  assert.equal(first.lastError, undefined);
  assert.equal(rendersUsableSurface(first), false, 'a probe in flight claimed a surface it has not shown');

  // The *retry* of a failed probe is the other case, and it is the one the finding names: the
  // surface is already on screen, and a re-probe that blanked it would flicker the diagnostics
  // away on every backoff — worse than the wrong verdict this state was added to stop.
  const retry = reduce(reduce(first, { type: 'compat-unavailable' }), { type: 'compat-retry' });
  assert.equal(retry.state, 'CompatCheck');
  assert.ok(rendersUsableSurface(retry), 'the retry blanked a surface the user was already reading');

  // `CompatCheck` stays out of the state-keyed set either way. It is not a place to rest — it
  // is bounded by the probe's own timeout — and putting it in the reachability goal set above
  // would make that test agree with itself for its two most interesting states.
  assert.equal(RENDERING_STATES.has('CompatCheck'), false);
});

test('a retry that succeeds stops stating a reason that no longer holds', () => {
  const retry = reduce(reduce(bootToCompatCheck(), { type: 'compat-unavailable' }), { type: 'compat-retry' });
  const ready = reduce(retry, { type: 'compat-classified', mode: 'full' });
  assert.equal(ready.state, 'Ready');
  assert.equal(ready.compat, 'full');
  assert.equal(ready.lastError, undefined, 'a healthy session kept reporting a probe that has since completed');

  // ...and it clears the compat code only. A classification says nothing about storage, so
  // `FE-BOOT-001` survives it — the session would otherwise forget why it is memory-only.
  let s = reduce(INITIAL_SESSION, { type: 'shell-parsed' });
  s = reduce(s, { type: 'storage-failed' });
  const rest = [
    'worker-up', 'relay-added', 'relay-finality-verified', 'first-finalized-para-head', 'genesis-matches',
  ] as const satisfies readonly PayloadFreeEvent[];
  for (const type of rest) s = reduce(s, { type });
  s = reduce(s, { type: 'compat-classified', mode: 'full' });
  assert.equal(s.state, 'Ready');
  assert.equal(s.memoryOnly, true);
  assert.equal(s.lastError, 'FE-BOOT-001', 'the compat edge cleared an error it did not resolve');
});
