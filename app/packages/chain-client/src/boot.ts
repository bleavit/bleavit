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
  /**
   * 10 §3.1's fourth `CompatCheck` exit — the probe did not complete (SQ-1011, 2026-08-08).
   *
   * Not a mode, and the session carries **no** `compat` while it is here: each of the three
   * modes is a claim about the runtime, and this is a claim about the client. Non-terminal,
   * and the only edge out is back into `CompatCheck`.
   */
  | 'CompatUnavailable'
  | 'Degraded'
  | 'WorkerFailed'
  | 'WasmFailed'
  | 'WrongChain';

/** 10 §3.2: the compat machine's mode is a session variable the boot machine carries. */
export type CompatMode = 'full' | 'restricted' | 'read-only-incompatible';

/**
 * The error codes 10 §3.1's machine names. Only `FE-BOOT-003` is terminal.
 *
 * `FE-COMPAT-003` is the one member outside the `FE-BOOT` family, and it is here because
 * §3.1 gained a state for it: the type is *the codes this machine can record*, not the codes
 * whose names begin with `FE-BOOT`.
 */
export type BootErrorCode =
  | 'FE-BOOT-001'
  | 'FE-BOOT-002'
  | 'FE-BOOT-003'
  | 'FE-BOOT-004'
  | 'FE-COMPAT-003';

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
  | { type: 'compat-unavailable' } //                    FE-COMPAT-003, non-terminal
  | { type: 'compat-retry' } //                          the §3.1 backoff, 1s -> 60s
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
      if (event.type === 'compat-classified') {
        return at(COMPAT_TARGET[event.mode], { compat: event.mode });
      }
      // The probe could not complete. **`compat` is cleared, not left**: §3.2 forbids
      // carrying a previously established mode across a check the client was unable to
      // make, and this arm is the only place the machine can hold a stale one.
      return event.type === 'compat-unavailable'
        ? at('CompatUnavailable', { compat: undefined, lastError: 'FE-COMPAT-003' })
        : session;

    case 'CompatUnavailable':
      // Non-terminal by ruling: the client retries into `CompatCheck` on the same backoff
      // `SyncDegraded` uses. Nothing else moves it, and it names no disabled surface on the
      // way out because nothing was examined.
      return event.type === 'compat-retry' ? at('CompatCheck', { lastError: undefined }) : session;

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

/**
 * Every (from, to) edge this reducer can take. The diagram in 10 §3.1 must equal it.
 *
 * **Both lists below are exhaustive by the compiler, not by hand (2026-08-08).** They were
 * plain arrays until the SQ-1011 ruling added `CompatUnavailable` and two events: the suite
 * that binds this function to §3.1's diagram reported the two new edges as missing, and it
 * would have reported nothing at all had the state been added here and the events forgotten.
 * A hand-kept enumeration of a closed union is a check that stops checking the moment the
 * union grows, so each is keyed by the union itself and a missing member fails to compile.
 */
export function transitionEdges(): readonly (readonly [BootState, BootState])[] {
  const everyState: Record<BootState, true> = {
    ShellLoaded: true, StorageOpen: true, WorkerSpawn: true, ChainStarting: true,
    RelaySyncing: true, ParaSyncing: true, SyncDegraded: true, IdentityCheck: true,
    CompatCheck: true, Ready: true, ReadyRestricted: true, ReadOnlyIncompatible: true,
    CompatUnavailable: true, Degraded: true, WorkerFailed: true, WasmFailed: true,
    WrongChain: true,
  };
  // One entry per event *type*, holding every payload worth driving. `compat-classified`
  // carries a mode, so it holds three; the rest hold themselves.
  const everyEvent: Record<BootEvent['type'], readonly BootEvent[]> = {
    'shell-parsed': [{ type: 'shell-parsed' }],
    'storage-open': [{ type: 'storage-open' }],
    'storage-failed': [{ type: 'storage-failed' }],
    'worker-up': [{ type: 'worker-up' }],
    'worker-failed': [{ type: 'worker-failed' }],
    'relay-added': [{ type: 'relay-added' }],
    'wasm-failed': [{ type: 'wasm-failed' }],
    'relay-finality-verified': [{ type: 'relay-finality-verified' }],
    'peers-lost': [{ type: 'peers-lost' }],
    'peer-acquired': [{ type: 'peer-acquired' }],
    'first-finalized-para-head': [{ type: 'first-finalized-para-head' }],
    'genesis-matches': [{ type: 'genesis-matches' }],
    'genesis-mismatch': [{ type: 'genesis-mismatch' }],
    'compat-classified': [
      { type: 'compat-classified', mode: 'full' },
      { type: 'compat-classified', mode: 'restricted' },
      { type: 'compat-classified', mode: 'read-only-incompatible' },
    ],
    'compat-unavailable': [{ type: 'compat-unavailable' }],
    'compat-retry': [{ type: 'compat-retry' }],
    'health-degraded': [{ type: 'health-degraded' }],
    'health-recovered': [{ type: 'health-recovered' }],
    'newer-release-loaded': [{ type: 'newer-release-loaded' }],
    'user-retry': [{ type: 'user-retry' }],
  };
  const edges = new Set<string>();
  for (const state of Object.keys(everyState) as BootState[]) {
    for (const event of Object.values(everyEvent).flat()) {
      const next = reduce({ ...INITIAL_SESSION, state }, event);
      if (next.state !== state) edges.add(`${state}>${next.state}`);
    }
  }
  return [...edges].sort().map((e) => e.split('>') as [BootState, BootState]);
}
