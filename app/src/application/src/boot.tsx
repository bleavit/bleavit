/**
 * Mount the shell — F7.
 *
 * ## Why this is not in `main.ts`
 *
 * F11 wrote `boot` into `main.ts` alongside a top-level `document.getElementById('app')`,
 * and `index.ts` re-exported it. That makes the package's *library* surface execute a
 * browser bootstrap at import: `await import('@bleavit/application')` in Node throws
 * `ReferenceError: document is not defined` before a single test runs. It was invisible
 * while nothing imported the package, and the first thing that did — F7's own suite —
 * failed on it immediately.
 *
 * So the two are separated by role, which is what the module comment in `main.ts` already
 * said they were: `main.ts` is the side-effect entry Vite builds and nothing imports, and
 * this file is a function.
 *
 * ## The initial state is "not read yet", and that is not a placeholder
 *
 * The shell renders before any chain read completes. `bootstrapPhase: undefined` is the
 * honest description of that moment, and `sudoBannerFor` treats it as INV-FE-12 requires —
 * the banner shows, with copy saying the phase could not be established. A client that
 * showed a clean header until the first read landed would be asserting post-sudo
 * governance for as long as the light client takes to sync, which on a cold start is the
 * longest and least attended part of a session.
 */

import { mount as mountTree } from '@bleavit/ui';
import {
  IndexBootDisclosure,
  bootLocalIndex,
  cannotObserve,
  deviceHints,
  enforceStorageBudget,
  storagePlatform,
} from '@bleavit/features-analysis';
import { registerReleaseWorker, type WorkerStatus } from './release-worker.js';
import { Shell, type ShellChainState } from './shell.js';
import { Outlet, screenFor } from './routes.js';
import { implementedScreens } from './composition.js';
import { releaseMetadataPins, releaseParaChain } from './chain-identity.js';

/**
 * What the shell shows before anything has been read: nothing, said out loud.
 *
 * This used to build a sentinel — `{ kind: 'verified-best', chain: '0x', blockHash: '0x',
 * blockNumber: 0 }` — and hang `0`, `'connecting…'` and `0` off it, with a comment arguing
 * that `verified-best` at height 0 "says" an unfinished read. It does not. INV-FE-9 defines
 * `verified-best` as *"unfinalized/best-head data"* and 10 §2.1 lists it as a light-client
 * read that may still reorg; nothing had been read here at all, on any chain, so the status
 * was a false statement and the zeros were values the client invented. That it was inert —
 * `combineStatus` refuses the empty chain id — made it harmless downstream without making it
 * true on screen, and the screen is where a badge is read.
 *
 * The repair is that the model now admits absence, so the pre-read state has a way to be
 * itself: every field is `undefined` and `EpochHeader` renders a sentence rather than a
 * number. `phaseFlags` was already `undefined` here, which is what makes the sudo banner show
 * during sync — the other three now say the same thing about themselves.
 */
function initialChainState(): ShellChainState {
  return {
    epoch: undefined,
    phaseLabel: undefined,
    finalizedHeight: undefined,
    // Unread, not "sudo absent". This is what makes the banner show during sync.
    phaseFlags: undefined,
  };
}

/**
 * The id of the screen a hash names.
 *
 * Delegates to `screenFor` rather than repeating the lookup. The two were briefly separate
 * implementations of one rule, which is a drift waiting to happen: the navigation would
 * highlight one screen while the outlet rendered another, and both would look correct in
 * isolation.
 */
export function screenForHash(hash: string, handoffEnabled: boolean): string {
  return screenFor(hash, handoffEnabled).id;
}

/**
 * What a mounted shell hands back to its one caller.
 *
 * `unmount` used to be dropped on the floor — `mountTree` returns it and the call site ignored
 * the value. That was invisible until F27 gave 10 §3.1's `WrongChain` a screen: the terminal
 * state replaces the tree, and `container.replaceChildren()` under a live React root deletes
 * nodes the root still believes it owns. React does not notice at the moment of deletion; it
 * notices at the next render against that container, which is the worst place to find out.
 *
 * So the handle is returned, and the terminal path calls it before it writes. This is also why
 * the return is a record rather than the bare `WorkerStatus`: the worker status is what the
 * caller *asked* for, and the unmount is what it turned out to owe.
 */
export interface BootedShell {
  /** 12 §5.2's release-worker state, as `registerReleaseWorker` reported it. */
  readonly worker: WorkerStatus;
  /** Tear the mounted tree down. Safe to call once; React's own `unmount` clears the container. */
  readonly unmount: () => void;
}

export async function boot(container: Element): Promise<BootedShell> {
  const handoffEnabled = true;
  const hash = globalThis.location?.hash ?? '';
  const active = screenForHash(hash, handoffEnabled);
  // The composition root lives in `composition.tsx` — the only place the three compilation
  // units meet. It is a map rather than an import inside `routes.tsx` because `tx` and
  // `handoff` may not see each other (10 §10.2); assembling it at the top level is what
  // keeps that true while still letting one outlet render either unit's screens.
  const implemented = implementedScreens();
  // 10 §3.1's `StorageOpen`, and F25's whole point: `checkIndexAtBoot` now has a production
  // call site, and what it returns is rendered rather than logged. It is awaited before the
  // mount only because it does no I/O in this build — `releaseParaChain()` is `unpinned`, so
  // `bootLocalIndex` returns without touching IndexedDB. §3.1 puts the skeleton render *before*
  // `StorageOpen`, so once a genesis pin lands the open has to move after the first paint,
  // which needs a re-render path this build does not have (recorded in PLAN.md, not assumed).
  //
  // `cannotObserve` is the honest observer, not a stub: nothing here starts a light client, so
  // the chain's answer about every range's edge really is *cannot say* — which §6.3 says keeps
  // the range and lists it as unchecked, never as one that passed.
  const chain = releaseParaChain();
  const { state: indexState, db } = await bootLocalIndex(chain, cannotObserve);
  // F14 — 10 §9.2's quota manager reaches a running client. §9.4's *IndexedDB growth* row
  // budgets *"§9.2 caps (300 MB / 75 MB) with auto-tuned retention"* and enforces it through
  // *"quota manager + tests"*; the manager existed in full and was called by nothing outside its
  // own suite, so on a running client no cap was held at all. The handle `bootLocalIndex`
  // returns is what this runs against — it is deliberately returned so a later consumer need not
  // reopen the database, and this is that consumer.
  //
  // **Under `fut-ingest`.** The pass deletes rows and rewrites one `meta` row wholesale, so two
  // tabs booting together would each persist their own label accumulator and the later one would
  // erase a label whose rows the earlier had already deleted — §9.2 obligation 1's silent
  // splice, produced by a user having the app open twice. §4.4 gives that writer role to the
  // leader, and `withIngestLock` had no production caller until this line.
  //
  // The platform is classified rather than assumed and fails closed to the 75 MB mobile cap; the
  // metadata pins are `unnameable` rather than empty, since nothing here reads the chain. Both
  // decisions are rendered, because §9.2 calls the ladder "deterministic and user-visible".
  //
  // **Awaited before the mount for the same reason the boot check is, and it inherits the same
  // note one paragraph up — with more force.** Today it returns immediately, because there is no
  // database to apply a budget to. Once a genesis pin lands it will not: a full pass at the
  // desktop raw share is thousands of folded buckets, and §9.4 budgets *first meaningful render*
  // at 1.5 s p50 on the same reference hardware this milestone measures. So the move after the
  // first paint that `StorageOpen` needs is the move this call needs too, and the render budget
  // is what would notice if it were skipped.
  const retention = await enforceStorageBudget(db, {
    chain,
    locks: globalThis.navigator?.locks,
    profile: storagePlatform(deviceHints(globalThis.navigator)),
    pins: releaseMetadataPins(),
    now: Math.floor(Date.now() / 1000),
  });
  const unmount = mountTree(
    container,
    <Shell chain={initialChainState()} handoffEnabled={handoffEnabled} activeScreen={active}>
      <IndexBootDisclosure state={indexState} retention={retention} />
      <Outlet hash={hash} handoffEnabled={handoffEnabled} implemented={implemented} />
    </Shell>,
  );
  // Registered after the tree is up: a release-worker failure must not stop the app
  // rendering, since the verification panel is one of the things that still renders when
  // smoldot never starts (12 §5.2).
  try {
    return { worker: await registerReleaseWorker(), unmount };
  } catch (error) {
    // **The guarantee that a rejected `boot` never left a tree behind is enforced here,
    // where the mount is, rather than asserted at the call site.** It was true by accident:
    // `registerReleaseWorker` happens to catch everything, so nothing after the mount could
    // reject. Both comments above record that `bootLocalIndex` and `enforceStorageBudget`
    // must move *after* the first paint, and on the day they do, an unmounted-but-rendered
    // tree would come back — with the terminal screen clearing a container React still owns,
    // which is the exact defect this file was changed to fix.
    unmount();
    throw error;
  }
}

/**
 * Boot the shell, connect the chain, and route a terminal failure to its screen.
 *
 * This is the whole of `main.ts`'s job, moved into a file a test can import. `main.ts` reads
 * `document` at module scope, so nothing can import it — which was a fair trade while it held
 * two calls and no logic, and stopped being one when 10 §3.1's terminal state needed the mount
 * handle threaded from `boot` to the `.catch`. That thread is what carries `FE-BOOT-003` to a
 * screen, and leaving it there would have made it the one part of the boot path no suite could
 * execute, in a milestone whose subject is checks that quietly stopped checking.
 *
 * Every collaborator is injected and none is defaulted, for the reason `chain-session.ts` gives
 * about `start`: `connectAndClassify` reaches PAPI and `@polkadot-api/descriptors`, and a
 * default here would load both into every Node suite that imports this package.
 */
export interface ShellDeps<C> {
  /** Usually {@link boot}. */
  readonly mount: (container: C) => Promise<BootedShell>;
  /** Usually `connectAndClassify` from `chain-boot.ts`. */
  readonly connect: () => Promise<unknown>;
  /** Usually `handleTerminalBootFailure`. Re-throws anything that is not a wrong chain. */
  readonly onFailure: (container: C, error: unknown, unmount?: () => void) => void;
}

export async function startShell<C>(container: C, deps: ShellDeps<C>): Promise<void> {
  // `undefined` until the mount resolves, and that is a real state rather than a missing case:
  // a `mount` that rejects never mounted, so there is nothing for the terminal screen to take
  // down. The failure this carries is raised later, by `connect`.
  let unmount: (() => void) | undefined;
  try {
    unmount = (await deps.mount(container)).unmount;
    await deps.connect();
  } catch (error) {
    deps.onFailure(container, error, unmount);
  }
}
