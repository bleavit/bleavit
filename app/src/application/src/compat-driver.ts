/**
 * Re-running 10 §5.2's classifier for as long as the session lasts — 10 §3.1, §3.2.
 *
 * F26 gave the classifier a production caller for the **first** verdict and stopped there:
 * `connectAndClassify` classified once, at boot, and threw the result away. Two obligations of
 * §3.2 had no code behind them at all, and neither is visible in a green run, because both are
 * about what happens *after* a healthy boot:
 *
 *  1. *"§3.2 re-runs the classifier on **every** `CodeUpdated`"* (§4.1 obligation 2). A runtime
 *     upgrade that moves a frozen surface must move this client's mode. Without it a session
 *     that booted `full` reports `full` against a runtime it has never examined — and §3.2 names
 *     that exact outcome as *"the failure this state exists to make impossible"*.
 *  2. *"`CompatUnavailable` … retries into `CompatCheck` on the same 1 s→60 s backoff as
 *     `SyncDegraded`"* (§3.1). The state is **non-terminal**, and a non-terminal state whose only
 *     exit nothing ever fires is terminal in every way a user can observe.
 *
 * ## What this module does and does not own
 *
 * It owns the **session variable** §3.2 describes — *"the compat machine's mode is a
 * session-scoped variable that the boot machine's terminal healthy states parameterize"* — and
 * nothing else. It does not drive `packages/chain-client`'s boot reducer: §3.1's diagram draws no
 * edge from `Ready` back into `CompatCheck`, `tests/chain-client/boot.test.ts` binds that
 * reducer's edge set to the diagram, and a mid-session re-classification is a change to the
 * variable rather than a new edge. Modelling it as an edge would put this client's machine and
 * the specification's diagram into disagreement in order to express something the specification
 * already expresses as a variable.
 *
 * Everything it touches is injected: the classifier, the runtime reading, the finalized-block
 * subscription and the timer. That is `chain-boot.ts`'s shape for the same reason — the module
 * that names PAPI must stay on the far side of a seam a Node suite can drive — and it is what
 * lets the backoff be asserted in microseconds rather than in minutes.
 */

import type { RuntimeVersionReport } from '@bleavit/chain-client';
import { runtimeMoved, verdictAllowsSigning, type CompatVerdict } from './compat-session.js';

/**
 * The first retry delay — 10 §3.1: *"retry (backoff 1s→60s)"*.
 *
 * A **UI** timer, not a chain tunable, so 10 §5.4's no-hardcode rule does not reach it: there is
 * no `Params` key and no metadata constant for a client-side retry cadence, and §3.1 states the
 * two endpoints itself.
 */
export const COMPAT_RETRY_MIN_MS = 1_000;

/** The ceiling of the same sequence — 10 §3.1's *"60s"*. */
export const COMPAT_RETRY_MAX_MS = 60_000;

/**
 * The delay before retry number `attempt` (0-based) — 10 §3.1's 1 s→60 s backoff.
 *
 * **The specification fixes the endpoints and not the growth law**, and that is stated here
 * rather than glossed: §3.1 writes *"backoff 1s→60s"* on two edges and says nothing about what
 * happens between them. Doubling is the reading — it is what "backoff" between a floor and a
 * ceiling means everywhere it is written without qualification, and §3.1 gives this edge and
 * `SyncDegraded`'s the *same* sequence, so whatever law is chosen must serve both. The clamp is
 * the part that matters and it is not a rounding: the sequence must actually **reach** 60 s and
 * stay there, because §3.1's whole point about this state is that the retry continues *"for as
 * long as the probe keeps failing"*. A sequence that kept doubling past the ceiling would stop
 * retrying in any session a user is present for.
 *
 * So: 1, 2, 4, 8, 16, 32, 60, 60, … — seven attempts inside the first two minutes, then once a
 * minute forever.
 *
 * A negative or non-integral `attempt` is floored at the minimum rather than trusted, because the
 * caller is a counter and a counter that has gone wrong must not produce a delay of zero — a
 * zero-delay retry loop against a chain that cannot answer is a busy wait on the main thread.
 */
export function compatRetryDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return COMPAT_RETRY_MIN_MS;
  const grown = COMPAT_RETRY_MIN_MS * 2 ** Math.floor(attempt);
  return Math.min(grown, COMPAT_RETRY_MAX_MS);
}

/** Whether a verdict leaves compatibility unestablished, and therefore owes a retry. */
export function verdictIsUnestablished(verdict: CompatVerdict): boolean {
  return verdict.kind === 'unestablished';
}

/**
 * The sentence a surface shows when the session may not sign — `undefined` when it may.
 *
 * The one place a caller asks *"may this session sign at all?"*, and it delegates to
 * {@link verdictAllowsSigning} rather than re-deriving the answer, for the reason that helper
 * gives about `callIsProven`: two copies of one closed-set decision drift apart at exactly the
 * moment SQ-577 makes per-call signing real, and the copy that does not move is the one written
 * out longhand.
 */
export function signingBlockedReason(verdict: CompatVerdict): string | undefined {
  if (verdictAllowsSigning(verdict)) return undefined;
  if (verdict.kind === 'classified') {
    return verdict.classification.mode === 'read-only-incompatible'
      ? `This release ships no descriptors for runtime ${verdict.classification.specVersion}, so ` +
          'nothing can be signed until a newer release is loaded (10 §5.3).'
      : `${verdict.classification.disabled.length} frozen surface(s) did not pass this release's ` +
          'compatibility check, so signing is unavailable (10 §3.2, INV-FE-12).';
  }
  return verdict.reason;
}

/**
 * A schedulable delay. `setTimeout` in production; a queue in a suite.
 *
 * Returns its own cancel, so a watch torn down mid-backoff leaves no timer holding a reference to
 * a classifier over a client that has been stopped.
 */
export type ScheduleDelay = (ms: number, run: () => void) => () => void;

const scheduleWithTimeout: ScheduleDelay = (ms, run) => {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
};

export interface CompatWatchDeps {
  /**
   * The verdict the boot already produced, and the **only** input this watch does not publish.
   *
   * Its caller already holds it and has already rendered it, so re-publishing would put the same
   * value on screen twice. What it is read for is the retry: §3.1 arms the 1 s→60 s backoff on
   * a probe that did not complete, and a boot that ended in `CompatUnavailable` is exactly the
   * session that owes one. A boot that classified owes nothing until the runtime moves.
   */
  readonly initial: CompatVerdict;
  /**
   * Run 10 §5.2's classifier again. Usually `classifyChain(client)`.
   *
   * Must not throw for a chain that cannot be read — `classifyLocalRuntime` returns every such
   * outcome as an `unestablished` verdict, and the one exception it does raise is a defect in
   * this release's own manifest, which is caught here and turned into a published verdict rather
   * than an unhandled rejection on a timer nobody is awaiting.
   */
  readonly reclassify: () => Promise<CompatVerdict>;
  /**
   * The transport's finalized runtime **now**. Usually `client.transport.finalizedRuntime()`.
   *
   * `undefined` is a real answer: `ChainHeadConnection` reports it for a follow that has not
   * initialized and for a connection that dropped runtime announcements, and §3.2 forbids
   * carrying a mode across a runtime change the client was unable to examine — which is what an
   * unreadable runtime is.
   */
  readonly runtimeNow: () => RuntimeVersionReport | undefined;
  /**
   * Subscribe to finalized blocks. Usually `client.transport.onFinalized`.
   *
   * The listener takes no argument: what this watch does at each finalized block is re-read
   * `runtimeNow()` and compare, so the hash is not the input to any decision here. Passing it
   * would invite a caller to think it was.
   */
  readonly onFinalized: (listener: () => void) => () => void;
  /** Where each verdict goes — the shell's re-render, and anything else holding the session. */
  readonly publish: (verdict: CompatVerdict) => void;
  /** Injected in suites. Production uses `setTimeout`. */
  readonly schedule?: ScheduleDelay;
}

/**
 * Watch the runtime and keep the session's verdict true — 10 §3.2, §3.1.
 *
 * Returns the stop handle. Four rules, each of which is a sentence of the specification:
 *
 * 1. **Every `CodeUpdated` re-runs the classifier** (§4.1 obligation 2, citing §3.2). Seen as a
 *    change in the finalized runtime report — see {@link runtimeMoved} for why that is the same
 *    event and the better observable.
 * 2. **The established mode is dropped the moment the runtime moves, before the new probe
 *    finishes** (§3.2: *"the previously established mode **MUST NOT** be carried across a runtime
 *    change the client was unable to examine"*). The window between the upgrade and the new
 *    verdict is precisely a runtime this client has not examined, so a session that kept
 *    reporting `full` through it would be reporting a mode about a runtime nothing read — the
 *    failure §3.2 names. INV-FE-12's direction settles the tie: unproven is *absent*.
 * 3. **An unestablished verdict retries into the classifier on §3.1's backoff**, and keeps
 *    retrying while it stays unestablished. The attempt counter is what grows, and it resets on
 *    any completed classification and on any observed runtime change — a new runtime is a new
 *    question, and answering it on the tail of the old question's backoff would make a client
 *    that had been failing for an hour wait a minute before looking at an upgrade.
 * 4. **One probe at a time.** A re-classification in flight when the next finalized block lands
 *    is not re-entered: §4.1 costs a probe a second `Chain` handle and an equal share of one
 *    core, and stacking them is the resource leak that section's two obligations exist to
 *    prevent. The pending flag instead records that the runtime moved again, and the classifier
 *    runs once more as soon as it is free — so an upgrade during a probe is never missed, which
 *    is the half a plain "skip if busy" would lose.
 */
export function watchCompat(deps: CompatWatchDeps): () => void {
  const schedule = deps.schedule ?? scheduleWithTimeout;
  let stopped = false;
  let running = false;
  /** A runtime change observed while a probe was in flight. Rule 4's memory. */
  let rerunWanted = false;
  let attempt = 0;
  let cancelTimer: (() => void) | undefined;
  /** The runtime the last published verdict describes. `undefined` until one is established. */
  let observed: RuntimeVersionReport | undefined = deps.runtimeNow();

  const publish = (verdict: CompatVerdict): void => {
    if (stopped) return;
    deps.publish(verdict);
  };

  const armRetry = (): void => {
    if (stopped) return;
    cancelTimer?.();
    const delay = compatRetryDelayMs(attempt);
    attempt += 1;
    cancelTimer = schedule(delay, () => {
      cancelTimer = undefined;
      void probe();
    });
  };

  const probe = async (): Promise<void> => {
    // Rule 4: remember rather than re-enter. `probe` re-checks this flag on the way out.
    if (running) {
      rerunWanted = true;
      return;
    }
    if (stopped) return;
    running = true;
    try {
      // Recorded **before** the await, never after it. This names the runtime the probe is about,
      // and it is what makes the *next* `CodeUpdated` detectable; writing it on the way out would
      // overwrite a change `onFinalized` observed while the probe was in flight, and the watch
      // would then compare the following block against a runtime that is already history.
      observed = deps.runtimeNow();
      let verdict: CompatVerdict;
      try {
        verdict = await deps.reclassify();
      } catch (error) {
        // `classifyLocalRuntime` throws only on a `ProbeCoverageError` — a defect in this
        // release's own manifest. It stays loud in the boot path, which is where a developer
        // sees it; here it is on a timer with no awaiting caller, so an unhandled rejection
        // would take the retry loop down and leave the session on a stale verdict forever.
        // Published as unestablished, which is what it is: no verdict was reached.
        verdict = {
          kind: 'unestablished',
          code: 'FE-COMPAT-003',
          reason:
            'This client could not complete a compatibility check against the runtime now on ' +
            `chain: ${error instanceof Error ? error.message : String(error)}. Nothing is ` +
            'treated as available until it can (10 §5.2).',
        };
      }
      if (stopped) return;
      publish(verdict);
      if (verdictIsUnestablished(verdict)) {
        armRetry();
      } else {
        // A completed classification retires the backoff — §3.1 retires `FE-COMPAT-003` only on
        // a classification that completes, and this is that edge.
        attempt = 0;
        cancelTimer?.();
        cancelTimer = undefined;
      }
    } finally {
      running = false;
    }
    if (rerunWanted && !stopped) {
      rerunWanted = false;
      void probe();
    }
  };

  const onBlock = (): void => {
    if (stopped) return;
    const now = deps.runtimeNow();
    if (runtimeChanged(observed, now) === undefined) return;
    // Rule 2: the mode goes **before** the new probe completes. The runtime in front of this
    // client is one it has not examined, and §3.2 forbids carrying the old mode across it.
    observed = now;
    attempt = 0;
    cancelTimer?.();
    cancelTimer = undefined;
    publish(runtimeChangedVerdict(now));
    void probe();
  };

  const unsubscribe = deps.onFinalized(onBlock);
  if (verdictIsUnestablished(deps.initial)) armRetry();

  return () => {
    stopped = true;
    cancelTimer?.();
    cancelTimer = undefined;
    unsubscribe();
  };
}

/**
 * Whether the runtime under this session changed, in either direction.
 *
 * `runtimeMoved` answers *"did `before` become `after`"* and takes a **present** `before`,
 * because its own caller has just read one. A watch has neither guarantee: it starts before the
 * first finalized block on a connection that reports `undefined`, and a connection can lose track
 * of the runtime mid-session and report `undefined` again. Both directions are changes this watch
 * must act on — the second one especially, since it is the reading `ChainHeadConnection` gives
 * when announcements were dropped and *"an upgrade may have been among them"*.
 */
function runtimeChanged(
  before: RuntimeVersionReport | undefined,
  after: RuntimeVersionReport | undefined,
): string | undefined {
  if (before === undefined) {
    return after === undefined ? undefined : `the runtime is now ${after.specName} ${after.specVersion}`;
  }
  return runtimeMoved(before, after);
}

/** The verdict a session holds between an observed runtime change and the new classification. */
function runtimeChangedVerdict(now: RuntimeVersionReport | undefined): CompatVerdict {
  const named =
    now === undefined
      ? 'a runtime this client can no longer name'
      : `runtime ${now.specName} ${now.specVersion}`;
  return {
    kind: 'unestablished',
    code: 'FE-COMPAT-003',
    reason:
      `The chain is now running ${named}, and this client has not finished checking it. The ` +
      'compatibility this session established describes the previous runtime and is not carried ' +
      'across the change, so nothing is treated as available and nothing can be signed until the ' +
      'check completes (10 §3.2, INV-FE-12).',
  };
}
