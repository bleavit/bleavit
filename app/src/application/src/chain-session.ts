/**
 * Starting the light client — 10 §3.1, §4.1; the caller `startLightClient` did not have. F18.
 *
 * `packages/chain-client/src/light-client.ts` has existed since F3 and nothing has ever called
 * it. That is the whole of what PLAN.md's F18 row calls *"live wiring"*, and it is not an
 * oversight in the package: the function needs two things a package must not decide — a
 * `Worker` (a bundler contract, §4.4's *"one dedicated `Worker` per tab"*) and a **pin** (a
 * release fact) — so the call belongs at a composition root. This is that root.
 *
 * ## The pin is injected, and that is a rule rather than a convenience
 *
 * Every identity in this client arrives by injection already: `ChainHeadConnection.open`
 * requires `chain` with no default, `fundingReaders` refuses two readers sharing a chain
 * identity, and the USDC Location is a required parameter proved by a negative-compilation
 * fixture. This module keeps that shape for the one identity above all of them — which chain
 * the client boots against.
 *
 * The consequence is the point. A **production** composition root injects
 * `releaseChainSpecs()`, which is `unpinned` while `release-sources.json` carries null
 * `chainSpecHashes` and `genesisHashes`; a **drill** harness injects a development pin it
 * produced itself. Neither can become the other, because a development pin is never in a field
 * a release reads. The alternative that was on the table — a development channel beside the
 * production one in the release format — would need a refusing gate and would put the two one
 * naming accident apart: a release pinned to `bleavit_dev` on `paseo-local` passes
 * `verifyBundledChainSpec`, passes the §3.1 genesis check, and reports `verified` about a chain
 * that is not Bleavit. This repository's most frequent defect is a true statement about the
 * wrong chain, and it has been caught in `readDepositInputs(reader, reader, …)`, in the
 * provider wrong-chain arm, and in an Asset Hub bundle pinning our own genesis.
 *
 * ## Why `start` is a parameter and `startLightClient` is not imported here
 *
 * `light-client.ts` is the one module in this repository that names PAPI and smoldot, and the
 * one no test executes. Importing it here would pull `polkadot-api/smoldot/from-worker` into
 * every Node suite that imports `@bleavit/application` — `tests/screens` does — and it would
 * put the rules below on the far side of a seam nothing can drive. So the rules live here and
 * the function arrives as an argument, exactly as `asset-hub.ts` takes its transport. The
 * supply site is `chain-boot.ts`, which `main.ts` imports and nothing else does.
 *
 * ## Honest limit
 *
 * Everything below the injected seam — that smoldot syncs, that browser-WSS peers are
 * reachable, that a follow subscription behaves as specified — is not verified by any test
 * here. What is verified is every decision this module makes *before* and *after* that call,
 * which is where the failures that matter are: a pin that is not a pin booting anyway, a
 * worker left running after a failed start, and a terminal wrong-chain verdict softened into a
 * retryable one.
 */

import type { BundledChain, PinnedChainSpec } from '@bleavit/chain-client';
import { WrongChainError } from '@bleavit/chain-client';
// Type-only, therefore erased: importing this file loads no smoldot module. `LightClientOptions`
// is the real one rather than a structural restatement, so a field added or renamed in
// `light-client.ts` breaks this build instead of quietly drifting away from it.
import type { LightClientOptions } from '@bleavit/chain-client/light-client';

/**
 * Which chains this build may boot against, or the reason it may boot against none.
 *
 * A closed union rather than a nullable pair, for the reason 10 §5.4 gives about the pins
 * themselves: *"a null is a readiness blocker, never a default"*. An `unpinned` value carries
 * a sentence a user can read, and there is no arm a caller can dereference into a chain.
 */
export type ChainSpecs =
  | { readonly kind: 'pinned'; readonly relay: BundledChain; readonly para: BundledChain }
  | { readonly kind: 'unpinned'; readonly reason: string };

/**
 * Where the smoldot `Worker` comes from, or the reason there is none.
 *
 * The same union shape as {@link ChainSpecs}, and for the same reason: 10 §3.1 already has a
 * state for a client that cannot spawn one — `WorkerFailed` / `FE-BOOT-002` — whose renderable
 * surface is *"docs, settings, verification panel, cached dashboard"*. So a missing worker is
 * a **declared** state of this build rather than an exception thrown from a branch nobody
 * reaches, and it renders like every other named absence in this client.
 *
 * A factory rather than a `Worker`, so that a build with nothing to boot against never
 * constructs one. That is checkable — the suite asserts the factory is not called — where a
 * constructed-and-unused worker is a running WASM light client nothing observes.
 */
export type WorkerSource =
  | { readonly kind: 'spawnable'; readonly createWorker: () => Worker }
  | { readonly kind: 'unspawnable'; readonly reason: string };

/**
 * Generic in the client, and **not** in the options.
 *
 * `LightClient` is `ChainHeadConnection` plus a `Topology` over real smoldot `Chain` objects,
 * and `ChainHeadConnection` has `#private` fields — so it is nominal, and no double can
 * satisfy it. A module that named it in its own signature would be one no test could drive,
 * which is `light-client.ts`'s position exactly and the position this file exists to leave.
 * The parameter is the same device `topology.ts` uses for smoldot's `Chain`: production infers
 * it from `startLightClient`'s own return type, so nothing is loosened where it matters.
 *
 * `LightClientOptions` stays concrete for the opposite reason. It is what this module
 * *constructs*, so restating it structurally would let a field be added over there and
 * silently not supplied here.
 */
export interface ChainSessionDeps<C> {
  /** The release's or the harness's pin. No default — see this module's header. */
  readonly specs: ChainSpecs;
  readonly worker: WorkerSource;
  /** `startLightClient`. Injected; see this module's header. */
  readonly start: (options: LightClientOptions) => Promise<C>;
  /** 10 §4.3 expert setting; local-only, never remote-configured. */
  readonly extraBootnodes?: readonly string[];
}

/**
 * The outcome of trying to start.
 *
 * `not-started` is a first-class state rather than an error: 10 §3.2 lists what still renders
 * when smoldot never starts, so a client that threw here would lose the verification panel,
 * the release self-check and the whole handoff surface along with the chain.
 */
export type ChainSession<C> =
  | { readonly kind: 'started'; readonly client: C }
  | { readonly kind: 'not-started'; readonly reasons: readonly string[] };

/** A pin this build refuses to hand to a light client. Named, so the refusal is not a silence. */
export class UnusablePinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusablePinError';
  }
}

const HASH = /^0x[0-9a-f]{64}$/i;

/**
 * Why a pin cannot be used, or `undefined`.
 *
 * The check that earns this function is the **shape of the hashes**. `release-sources.json`
 * carries `chainSpecHashes` and `genesisHashes` as `null` today and its own note says why —
 * *"a bundle that shipped a null genesis pin would run `verifyChainIdentity` against nothing
 * and report `verified`"*. A `null` that reached this far would arrive as `undefined`, the
 * string `"null"`, or an empty string, and each compares unequal to whatever the chain
 * reports, so `verifyBundledChainSpec` and `assertGenesisIdentity` do fail closed on it. What
 * they cannot do is fail closed *before a worker exists and a chain has been dialled*, and
 * they report it as a mismatch rather than as a release that was never finished. Both matter:
 * the first is resources, the second is which of two very different repairs a reader goes
 * looking for.
 */
function unusable(pinned: PinnedChainSpec, role: string): string | undefined {
  if (!HASH.test(pinned.sha256)) {
    return `the ${role} pin carries no usable chain-spec hash (${JSON.stringify(pinned.sha256)})`;
  }
  if (!HASH.test(pinned.genesisHash)) {
    return `the ${role} pin carries no usable genesis hash (${JSON.stringify(pinned.genesisHash)})`;
  }
  return undefined;
}

/**
 * Start the light client for the injected pin, or say why there is none.
 *
 * Four properties, each of which fails silently if it is got wrong:
 *
 * 1. **A build with no pin, or no worker, calls nothing.** The suite asserts the factory was
 *    never called, because *"we did not connect"* and *"we connected to whatever was lying
 *    around"* look identical from the outside once a client is running.
 * 2. **Every reason is reported, not the first.** `depositBlocks` states the rule this follows:
 *    a reader told to fix one thing, who then hits the next, learns the report is guessing.
 *    Here the two blockers have different owners — a release pin and a bundler contract — so
 *    reporting one would send a reader to the wrong repair.
 * 3. **A failed start terminates the worker it constructed.** `startLightClient` tears down the
 *    chains and the smoldot client on its own failure path, and it never sees the worker — it
 *    was handed one. A worker left running is a WASM light client syncing with nothing reading
 *    it: the same unreferenced-resource leak `detach()` exists to prevent one layer down, in
 *    the one path where the obvious code does not reach the teardown.
 * 4. **A wrong chain is terminal and is re-thrown.** 10 §3.1 makes `FE-BOOT-003` terminal with
 *    no override, and `chain-spec.ts` states why it has no boolean return at all: *"a boolean
 *    invites a call site that logs it and carries on"*. Folding it into `not-started` would do
 *    exactly that, and worse — `not-started` reads as *could not connect, try again*, which is
 *    advice no retry can satisfy against a chain that is simply a different chain.
 */
export async function startChainSession<C>(deps: ChainSessionDeps<C>): Promise<ChainSession<C>> {
  const { specs, worker } = deps;
  const reasons = [
    specs.kind === 'unpinned' ? specs.reason : undefined,
    worker.kind === 'unspawnable' ? worker.reason : undefined,
  ].filter((reason): reason is string => reason !== undefined);
  if (reasons.length > 0) return { kind: 'not-started', reasons };
  // Narrowing by the arms rather than by `reasons.length`, so the compiler carries the proof.
  if (specs.kind !== 'pinned' || worker.kind !== 'spawnable') {
    throw new Error('unreachable: a blocker was present and produced no reason');
  }

  const faults = [
    unusable(specs.relay.pinned, 'relay'),
    unusable(specs.para.pinned, 'parachain'),
  ].filter((fault): fault is string => fault !== undefined);
  if (faults.length > 0) {
    throw new UnusablePinError(
      `${faults.join('; ')}. A release that pins nothing must not dial anything: every ` +
        'identity check downstream compares against the value that is missing, so the client ' +
        'would report a mismatch about a chain it should never have connected to (10 §5.4).',
    );
  }

  const spawned = worker.createWorker();
  try {
    const client = await deps.start({
      worker: spawned,
      relay: specs.relay,
      para: specs.para,
      ...(deps.extraBootnodes === undefined ? {} : { extraBootnodes: deps.extraBootnodes }),
    });
    return { kind: 'started', client };
  } catch (error) {
    // Terminated first, so a re-thrown terminal error cannot leave the worker behind.
    try {
      spawned.terminate();
    } catch {
      // A worker that is already gone is the state this is trying to reach.
    }
    if (error instanceof WrongChainError) throw error;
    return {
      kind: 'not-started',
      reasons: [
        `The light client did not start: ${error instanceof Error ? error.message : String(error)}. ` +
          'Nothing that does not need the chain is affected (10 §3.2).',
      ],
    };
  }
}
