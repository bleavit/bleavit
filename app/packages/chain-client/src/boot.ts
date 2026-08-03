/**
 * The boot state machine — 10 §3.1, §3.2.
 *
 * A pure reducer: no chain, no worker, no timers. Every state and every edge below is
 * testable with nothing running, which matters because the states this machine exists
 * for are the ones that only occur when something is broken — no peers on first load,
 * IndexedDB refused, a worker the CSP would not spawn.
 *
 * The reviewed machine lacked states for three of its own error codes, had no boot-time
 * `restricted` outcome and no pre-`Ready` degradation; 10 §3.1 completed it. Because the
 * spec ships that machine as a mermaid diagram, `tests/chain-client/boot.test.js` parses
 * the diagram **out of the document** and asserts this transition table equals it. Drift
 * in either direction is then a test failure rather than a discrepancy nobody re-reads.
 *
 * Three orthogonal session flags — `degraded`, `memoryOnly`, `rpcOnly` — combine with any
 * compat mode (10 §3.2). They are *not* states: modelling `MemoryOnly` as a state would
 * multiply the machine by the storage mode and lose the property that storage failure is
 * non-terminal and affects no protocol function.
 */

export type BootState =
  | 'ShellLoaded'
  | 'StorageOpen'
  | 'WorkerSpawn'
  | 'ChainStarting'
  | 'RelaySyncing'
  | 'ParaSyncing'
  | 'SyncDegraded'
  | 'IdentityCheck'
  | 'CompatCheck'
  | 'Ready'
  | 'ReadyRestricted'
  | 'ReadOnlyIncompatible'
  | 'Degraded'
  | 'WorkerFailed'
  | 'WasmFailed'
  | 'WrongChain';

/** 10 §3.2: the compat machine's mode is a session variable the boot machine carries. */
export type CompatMode = 'full' | 'restricted' | 'read-only-incompatible';

/** The boot error codes 10 §3.1 names. Only `FE-BOOT-003` is terminal. */
export type BootErrorCode = 'FE-BOOT-001' | 'FE-BOOT-002' | 'FE-BOOT-003' | 'FE-BOOT-004';

export type BootEvent =
  | { type: 'shell-parsed' }
  | { type: 'storage-open' }
  | { type: 'storage-failed' } //                        FE-BOOT-001, non-terminal
  | { type: 'worker-up' }
  | { type: 'worker-failed' } //                         FE-BOOT-002
  | { type: 'relay-added' }
  | { type: 'wasm-failed' } //                           FE-BOOT-004
  | { type: 'relay-finality-verified' }
  | { type: 'peers-lost' }
  | { type: 'peer-acquired' }
  | { type: 'first-finalized-para-head' }
  | { type: 'genesis-matches' }
  | { type: 'genesis-mismatch' } //                      FE-BOOT-003, terminal
  | { type: 'compat-classified'; mode: CompatMode }
  | { type: 'health-degraded' }
  | { type: 'health-recovered' }
  | { type: 'newer-release-loaded' }
  | { type: 'user-retry' };

export interface BootSession {
  readonly state: BootState;
  readonly compat: CompatMode | undefined;
  /** FE-BOOT-001: storage is unavailable. Non-terminal; no protocol function is affected. */
  readonly memoryOnly: boolean;
  /** Expert §4.5 fallback. Never set by this machine — carried so the product is explicit. */
  readonly rpcOnly: boolean;
  readonly lastError: BootErrorCode | undefined;
}

export const INITIAL_SESSION: BootSession = Object.freeze({
  state: 'ShellLoaded',
  compat: undefined,
  memoryOnly: false,
  rpcOnly: false,
  lastError: undefined,
});

/** States from which no event leads anywhere (10 §3.1: `WrongChain` is terminal, no override). */
export const TERMINAL_STATES: ReadonlySet<BootState> = new Set<BootState>(['WrongChain']);

/**
 * States in which the app renders a usable surface. `ReadOnlyIncompatible` is included
 * deliberately: 10 §5.3 makes it an *exceptional* state indicating process failure, but a
 * bounded and navigable one — it displays the newer-release pointer read from the
 * fixed-layout `ReleaseChannel` raw key, which is readable without current metadata.
 */
export const RENDERING_STATES: ReadonlySet<BootState> = new Set<BootState>([
  'Ready',
  'ReadyRestricted',
  'Degraded',
  'ReadOnlyIncompatible',
  'WorkerFailed',
  'WasmFailed',
]);

/**
 * Signing availability. `Degraded` is a health flag orthogonal to compat (10 §3.2), so it
 * does not itself disable signing — but no verified read exists without the light client,
 * so `WorkerFailed`/`WasmFailed` do.
 */
export function signingEnabled(session: BootSession): boolean {
  if (session.state === 'WorkerFailed' || session.state === 'WasmFailed') return false;
  if (session.state === 'ReadOnlyIncompatible') return false;
  if (session.rpcOnly) return false; // §2.2: normal-mode signing disabled in RPC-only operation
  return session.state === 'Ready' || session.state === 'ReadyRestricted' || session.state === 'Degraded';
}

const COMPAT_TARGET: Readonly<Record<CompatMode, BootState>> = Object.freeze({
  full: 'Ready',
  restricted: 'ReadyRestricted',
  'read-only-incompatible': 'ReadOnlyIncompatible',
});

/**
 * The transition function. Unknown (state, event) pairs return the session **unchanged**
 * rather than throwing or falling into a catch-all: a boot machine that crashed on an
 * out-of-order event would turn a recoverable race into a blank page, and one that had a
 * default edge would silently acquire transitions the diagram does not have.
 */
export function reduce(session: BootSession, event: BootEvent): BootSession {
  if (TERMINAL_STATES.has(session.state)) return session;
  const at = (state: BootState, patch: Partial<BootSession> = {}): BootSession =>
    Object.freeze({ ...session, state, ...patch });

  switch (session.state) {
    case 'ShellLoaded':
      return event.type === 'shell-parsed' ? at('StorageOpen') : session;

    case 'StorageOpen':
      // Both edges land in WorkerSpawn: FE-BOOT-001 is explicitly non-terminal, and the
      // transaction path never touches IndexedDB (10 §10), so nothing about protocol
      // function differs — only persistence, the local index and `stale-cache` tiles.
      if (event.type === 'storage-open') return at('WorkerSpawn');
      if (event.type === 'storage-failed') {
        return at('WorkerSpawn', { memoryOnly: true, lastError: 'FE-BOOT-001' });
      }
      return session;

    case 'WorkerSpawn':
      if (event.type === 'worker-up') return at('ChainStarting');
      if (event.type === 'worker-failed') return at('WorkerFailed', { lastError: 'FE-BOOT-002' });
      return session;

    case 'ChainStarting':
      if (event.type === 'relay-added') return at('RelaySyncing');
      if (event.type === 'wasm-failed') return at('WasmFailed', { lastError: 'FE-BOOT-004' });
      return session;

    case 'RelaySyncing':
      if (event.type === 'relay-finality-verified') return at('ParaSyncing');
      if (event.type === 'peers-lost') return at('SyncDegraded');
      return session;

    case 'ParaSyncing':
      if (event.type === 'first-finalized-para-head') return at('IdentityCheck');
      if (event.type === 'peers-lost') return at('SyncDegraded');
      return session;

    case 'SyncDegraded':
      // Back to RelaySyncing, not to wherever we came from: the parachain client cannot
      // run without the relay client (10 §3.1), so resync restarts at the relay.
      return event.type === 'peer-acquired' ? at('RelaySyncing') : session;

    case 'IdentityCheck':
      if (event.type === 'genesis-matches') return at('CompatCheck');
      if (event.type === 'genesis-mismatch') return at('WrongChain', { lastError: 'FE-BOOT-003' });
      return session;

    case 'CompatCheck':
      // The compat classifier is a lattice, not a boolean (10 §5.2): a partial pass boots
      // *directly* into restricted with named disabled surfaces rather than claiming
      // Ready and failing lazily.
      return event.type === 'compat-classified'
        ? at(COMPAT_TARGET[event.mode], { compat: event.mode })
        : session;

    case 'Ready':
    case 'ReadyRestricted':
      return event.type === 'health-degraded' ? at('Degraded') : session;

    case 'Degraded':
      return event.type === 'health-recovered' ? at('Ready') : session;

    case 'WorkerFailed':
    case 'WasmFailed':
      return event.type === 'user-retry' ? at('WorkerSpawn', { lastError: undefined }) : session;

    case 'ReadOnlyIncompatible':
      return event.type === 'newer-release-loaded' ? at('Ready', { compat: 'full' }) : session;

    default:
      return session;
  }
}

/** Every (from, to) edge this reducer can take. The diagram in 10 §3.1 must equal it. */
export function transitionEdges(): readonly (readonly [BootState, BootState])[] {
  const states: BootState[] = [
    'ShellLoaded', 'StorageOpen', 'WorkerSpawn', 'ChainStarting', 'RelaySyncing',
    'ParaSyncing', 'SyncDegraded', 'IdentityCheck', 'CompatCheck', 'Ready',
    'ReadyRestricted', 'ReadOnlyIncompatible', 'Degraded', 'WorkerFailed',
    'WasmFailed', 'WrongChain',
  ];
  const events: BootEvent[] = [
    { type: 'shell-parsed' }, { type: 'storage-open' }, { type: 'storage-failed' },
    { type: 'worker-up' }, { type: 'worker-failed' }, { type: 'relay-added' },
    { type: 'wasm-failed' }, { type: 'relay-finality-verified' }, { type: 'peers-lost' },
    { type: 'peer-acquired' }, { type: 'first-finalized-para-head' },
    { type: 'genesis-matches' }, { type: 'genesis-mismatch' },
    { type: 'compat-classified', mode: 'full' },
    { type: 'compat-classified', mode: 'restricted' },
    { type: 'compat-classified', mode: 'read-only-incompatible' },
    { type: 'health-degraded' }, { type: 'health-recovered' },
    { type: 'newer-release-loaded' }, { type: 'user-retry' },
  ];
  const edges = new Set<string>();
  for (const state of states) {
    for (const event of events) {
      const next = reduce({ ...INITIAL_SESSION, state }, event);
      if (next.state !== state) edges.add(`${state}>${next.state}`);
    }
  }
  return [...edges].sort().map((e) => e.split('>') as [BootState, BootState]);
}
