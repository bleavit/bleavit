/**
 * Boot the canonical client against a live Zombienet topology — F27; 15 §4.8.
 *
 * 15 §4.8's Zombienet row requires the client's data layer exercised *"against the published
 * topology"*, and until now nothing could: `light-client.ts` runs smoldot through a browser
 * worker pair, and the drill helpers run under the pinned Zombienet binary's own Node with no
 * bundler and no `Worker` global. `@bleavit/chain-client/node-light-client` is the seam that
 * closes that, and this is its one caller.
 *
 * ## Why this is a workspace member rather than a file in `app/tools/`
 *
 * The three tools that bind to a client package — `tools/desktop`, `tools/snapshot`,
 * `tools/render-budget` — are each workspace members, and `pnpm-workspace.yaml` states the
 * reason: a dependency declared at the root is resolvable from **every** package by the
 * parent-directory walk. That argument is at its strongest here. The thing being confined is
 * a second way to start a light client, which is precisely what app-code rule 13 exists to
 * prevent; confined to this member, `import '@bleavit/chain-client/node-light-client'` is
 * unresolvable everywhere else in `app/`.
 *
 * ## What it proves, and the one thing it must prove by failing
 *
 * A drill that only boots proves that a boot happened. The genesis identity check (10 §3.1,
 * `FE-BOOT-003`, terminal with no override) is the control that stops every downstream read
 * being honestly verified against the wrong chain, and a run where it never fires witnesses
 * nothing about it. So `--mode wrong-chain` corrupts one byte of the parachain pin and
 * **requires** `WrongChainError`; a successful boot under that mode is a failure of this
 * harness.
 *
 * ## Usage
 *
 * ```sh
 * node app/tools/drill-client/boot.ts \
 *   --pin <dev-pin.json>            \  # from app/tools/dev-chain-pin.ts
 *   --relay-bootnodes <multiaddr,…> \  # from system_localListenAddresses
 *   --para-bootnodes  <multiaddr,…> \
 *   [--asset-hub-bootnodes <multiaddr,…>] \
 *   [--mode boot|wrong-chain] [--timeout-seconds 120]
 * ```
 *
 * The report goes to stdout as one JSON object. Exit 0 means the mode's expectation held.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { WrongChainError, type BundledChain } from '@bleavit/chain-client';
import { startNodeLightClient } from '@bleavit/chain-client/node-light-client';
import type { LightClient } from '@bleavit/chain-client/light-client';
import { classifyChain, classifyAssetHubFor } from '@bleavit/application';

/** The `bleavit.dev-chain-pin.v1` document `app/tools/dev-chain-pin.ts` writes. */
interface DevPinRole {
  readonly id: string;
  readonly kind: 'relay' | 'para';
  readonly sha256: string;
  readonly genesisHash: string;
  readonly relayChainId?: string;
}
interface DevPinDocument {
  readonly schema: string;
  readonly relay: { readonly pinned: DevPinRole; readonly chainSpec: string };
  readonly para: { readonly pinned: DevPinRole; readonly chainSpec: string };
  readonly assetHub?: { readonly pinned: DevPinRole; readonly chainSpec: string };
}

export class DrillBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrillBootError';
  }
}

function argOf(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function required(argv: readonly string[], name: string): string {
  const value = argOf(argv, name);
  if (value === undefined) throw new DrillBootError(`--${name} is required and takes a value`);
  return value;
}

function addresses(argv: readonly string[], name: string): readonly string[] {
  const raw = argOf(argv, name);
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Flip the low nibble of the pinned parachain genesis.
 *
 * A *mutation* rather than a constant, so the wrong value is still a well-formed 32-byte hex
 * hash and reaches `assertGenesisIdentity` rather than being refused earlier by
 * `chain-session.ts`'s shape check. Those are different controls and only one of them is
 * under test here.
 */
export function corruptGenesis(hash: string): string {
  const last = hash.slice(-1);
  const flipped = last === '0' ? '1' : '0';
  return `${hash.slice(0, -1)}${flipped}`;
}

function bundled(role: { pinned: DevPinRole; chainSpec: string }): BundledChain {
  // The pin document's roles are structurally `PinnedChainSpec` already; the cast is avoided
  // by letting the compiler check the assignment through `BundledChain`.
  return { pinned: role.pinned as BundledChain['pinned'], chainSpec: role.chainSpec };
}

export interface DrillReport {
  readonly mode: 'boot' | 'wrong-chain';
  readonly chain: string;
  readonly genesisHash: string;
  readonly specVersion: number | undefined;
  readonly compat: string;
  /**
   * 10 §5.2's lattice — `full` / `restricted` / `read-only-incompatible`.
   *
   * `CompatVerdict.kind` distinguishes only *whether* a verdict was reached — `classified`,
   * `unestablished`, `not-attempted` — so recording it alone discards the verdict itself: a
   * `read-only-incompatible` runtime is `classified`, and a drill asserting only that would
   * pass on exactly the regression it exists to catch.
   */
  readonly compatMode: string | undefined;
  readonly assetHub: string | undefined;
  /**
   * 02 §7.7's foreign lattice — `full` / `restricted` / `unsupported` / `wrong-chain` /
   * `unreachable`.
   *
   * **This field exists because the line above it was the same defect one chain over (R-6
   * review, 2026-08-08).** `assetHub` recorded `ForeignVerdict.kind` alone, so a
   * `wrong-chain` Asset Hub, an `unsupported` one and a `restricted` one all reported
   * `"classified"` — and this drill is the only place `classifyForeign` runs against a real
   * chain. The reasoning that produced `compatMode` was written down two fields up and was
   * not carried across, which is how a fix stays local to the instance that prompted it.
   */
  readonly assetHubMode: string | undefined;
  readonly finalizedHash: string;
}

/**
 * Wait for the follow subscription to deliver a finalized head.
 *
 * The transport exposes `onFinalized` and no accessor for the current head, and taking the
 * first delivery is the better evidence anyway: an accessor could be answered from a value
 * the connection was opened with, while a delivered event is the parachain's finality
 * derived from relay-finalized para-inclusion (10 §4.1) actually arriving. That is the whole
 * of what a synced two-chain light client is for.
 */
function firstFinalized(client: LightClient, seconds: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new DrillBootError(
          `no finalized head arrived within ${seconds}s. The relay warp-syncs first and the ` +
            'parachain follows it, so this is what an unreachable peer set looks like from ' +
            'here — check the bootnode multiaddrs carry a peer id.',
        ),
      );
    }, seconds * 1000);
    const unsubscribe = client.transport.onFinalized((hash) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(hash);
    });
  });
}

/**
 * Stage traces on stderr — stdout stays the report alone, so a caller still parses it.
 *
 * A drill log that says only *"did not finish"* costs an hour. Each stage is announced before
 * it is attempted, so the last line printed names the step that hung rather than the step
 * before the one that hung.
 */
function stage(name: string): void {
  process.stderr.write(`[drill-client] ${name}\n`);
}

async function bootAndClassify(
  document: DevPinDocument,
  bootnodes: {
    readonly relay: readonly string[];
    readonly para: readonly string[];
    readonly assetHub: readonly string[];
  },
  timeoutSeconds: number,
): Promise<DrillReport> {
  stage('starting the light client');
  const client: LightClient = await startNodeLightClient({
    relay: bundled(document.relay),
    para: bundled(document.para),
    // **All three chains' peers**, and the Asset Hub entry is the one that was missing until
    // the R-6 review found it: it was collected, passed on the command line, parsed here and
    // then dropped, so the Asset Hub chain was dialled with peers that do not serve it. That
    // is a sufficient explanation for an `unavailable` verdict on its own, so the earlier
    // genesis-size reading of that verdict was not established.
    //
    // `withExtraBootnodes` applies the union to every spec it dials, and a peer that does not
    // serve a chain is simply not useful for it.
    extraBootnodes: [...bootnodes.relay, ...bootnodes.para, ...bootnodes.assetHub],
  });

  try {
    // Before anything is classified: the follow subscription must have delivered. A verdict
    // taken from a connection that never synced would describe an empty reading.
    stage('waiting for a finalized head');
    const finalizedHash = await firstFinalized(client, timeoutSeconds);
    stage(`finalized head ${finalizedHash}`);
    const runtime = client.transport.finalizedRuntime();
    stage('classifying the local runtime (10 §5.2)');
    const compat = await classifyChain(client);
    stage(`local verdict: ${compat.kind}`);

    let assetHub: string | undefined;
    let assetHubMode: string | undefined;
    if (document.assetHub !== undefined) {
      const leg = bundled(document.assetHub);
      stage('attaching Asset Hub');
      // **Bounded, and the bound is a finding rather than a convenience.** `connectAssetHub`
      // awaits a genesis probe on a chain smoldot is still initialising, and a foreign chain
      // that never answers would leave the caller waiting forever. 11 E17 requires the deposit
      // flow to be *"blocked with diagnostics"*, and an unbounded await is not that: it renders
      // as a spinner that never resolves. **This was fixed in the client** rather than left as
      // a spec question — `assetHubConnector.connect` takes a `deadlineMs` and abandons the
      // attempt at it, detaching the chain and closing any transport that lands afterwards.
      // The bound below is this harness's own, because a drill must fail rather than hang.
      //
      // The Asset Hub genesis is ~189k raw entries (a 79 MB spec), and smoldot warns that a
      // large `genesis.raw` slows initialisation substantially — so the honest bound here is
      // generous, and a timeout is reported as `unavailable` rather than as a failure.
      const connection = await Promise.race([
        client.connectAssetHub(leg),
        new Promise<'timed-out'>((resolve) =>
          setTimeout(() => resolve('timed-out'), timeoutSeconds * 1000),
        ),
      ]);
      if (connection === 'timed-out') {
        stage(`Asset Hub did not attach within ${timeoutSeconds}s`);
        return {
          mode: 'boot',
          chain: document.para.pinned.id,
          genesisHash: document.para.pinned.genesisHash,
          specVersion: runtime?.specVersion,
          compat: compat.kind,
          compatMode: compat.kind === 'classified' ? compat.classification.mode : undefined,
          assetHub: `unavailable: no genesis answer within ${timeoutSeconds}s`,
          assetHubMode: undefined,
          finalizedHash,
        };
      }
      if (connection.kind !== 'attached') {
        assetHub = `not-attached: ${connection.kind}`;
      } else {
        stage('classifying Asset Hub (02 §7.7)');
        const foreign = await classifyAssetHubFor(
          client,
          leg,
          document.assetHub.pinned.id,
          connection.transport.finalizedRuntime(),
          () => connection.transport.finalizedRuntime(),
        );
        assetHub = foreign.kind;
        assetHubMode = foreign.kind === 'classified' ? foreign.classification.mode : undefined;
      }
    }

    return {
      mode: 'boot',
      chain: document.para.pinned.id,
      genesisHash: document.para.pinned.genesisHash,
      specVersion: runtime?.specVersion,
      compat: compat.kind,
      compatMode: compat.kind === 'classified' ? compat.classification.mode : undefined,
      assetHub,
      assetHubMode,
      finalizedHash,
    };
  } finally {
    // **Bounded, because a stuck teardown must not cost the result.** `worker.terminate()`
    // cannot interrupt a worker thread inside a long synchronous WASM computation, and
    // smoldot is still building the Asset Hub genesis trie (~189k entries) when this runs.
    // The evidence is the report; a process that is about to exit does not need the thread
    // released politely, and the OS reclaims it either way.
    stage('stopping');
    await Promise.race([
      client.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
    stage('stopped');
  }
}

/**
 * The light-client call, injected — so every decision around it is testable without a chain.
 *
 * The same device `chain-session.ts` uses for `startLightClient`, and for the same stated
 * reason: the rules live where a suite can drive them, and the function that names smoldot
 * arrives as an argument. It matters most for the `wrong-chain` leg, whose whole content is
 * *what happens when the boot does not fail* — a case a real client cannot be asked to
 * produce, and the one a vacuous harness would silently pass.
 */
export type BootFn = (
  document: DevPinDocument,
  bootnodes: {
    readonly relay: readonly string[];
    readonly para: readonly string[];
    readonly assetHub: readonly string[];
  },
  timeoutSeconds: number,
) => Promise<DrillReport>;

export async function main(argv: readonly string[], boot: BootFn = bootAndClassify): Promise<string> {
  const document = JSON.parse(readFileSync(required(argv, 'pin'), 'utf8')) as DevPinDocument;
  if (document.schema !== 'bleavit.dev-chain-pin.v1') {
    throw new DrillBootError(`unexpected pin schema ${JSON.stringify(document.schema)}`);
  }
  const bootnodes = {
    relay: addresses(argv, 'relay-bootnodes'),
    para: addresses(argv, 'para-bootnodes'),
    assetHub: addresses(argv, 'asset-hub-bootnodes'),
  };
  const mode = argOf(argv, 'mode') ?? 'boot';
  const timeoutSeconds = Number(argOf(argv, 'timeout-seconds') ?? '120');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new DrillBootError('--timeout-seconds must be a positive number');
  }

  if (mode === 'boot') {
    return `${JSON.stringify(await boot(document, bootnodes, timeoutSeconds), null, 2)}\n`;
  }
  if (mode !== 'wrong-chain') {
    throw new DrillBootError(`unknown --mode ${JSON.stringify(mode)}; expected boot or wrong-chain`);
  }

  const corrupted: DevPinDocument = {
    ...document,
    para: {
      ...document.para,
      pinned: { ...document.para.pinned, genesisHash: corruptGenesis(document.para.pinned.genesisHash) },
    },
  };
  try {
    await boot(corrupted, bootnodes, timeoutSeconds);
  } catch (error) {
    if (error instanceof WrongChainError) {
      // **Bound to the pin this leg mutated.** `startTopology` asserts the RELAY identity
      // first, so a relay mismatch — a stale spec, a respawned network — produces a
      // `WrongChainError` too, and a leg that accepted any of them would report FE-BOOT-003
      // witnessed while the corrupted parachain pin was never reached. That is the same
      // shape as a check that cannot fail, which is what this milestone exists to find.
      const corruptedPara = corrupted.para.pinned.genesisHash;
      if (error.expected !== corruptedPara) {
        throw new DrillBootError(
          `the identity check fired on a chain this leg did not corrupt: it expected ` +
            `${error.expected}, and the corrupted parachain pin is ${corruptedPara}. The relay ` +
            'is asserted first, so this is most likely a relay pin that no longer matches the ' +
            'spawned network — re-read the specs from the network directory.',
        );
      }
      return `${JSON.stringify(
        {
          mode: 'wrong-chain',
          refused: true,
          code: error.code,
          role: 'para',
          expected: error.expected,
          observed: error.observed,
          uncorrupted: document.para.pinned.genesisHash,
        },
        null,
        2,
      )}\n`;
    }
    throw new DrillBootError(
      `the corrupted pin was refused, but not by the identity check: ${String(error)}. ` +
        '10 §3.1 makes FE-BOOT-003 the terminal state for a chain that is not this one, and a ' +
        'refusal from anywhere else leaves that control unwitnessed.',
    );
  }
  throw new DrillBootError(
    'the client booted against a corrupted parachain genesis pin. 10 §3.1 makes this ' +
      'terminal with no override, because a chain that is not Bleavit answers every ' +
      'subsequent read consistently and nothing downstream can tell.',
  );
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const argv = process.argv.slice(2);
  const report = await main(argv);
  /**
   * **`--report` exists because stdout is a shared channel and the report is not the only
   * thing on it.** The drill used to parse this process's whole stdout as JSON, which worked
   * exactly as long as nothing else wrote a byte. smoldot's log callback does, from a worker
   * thread whose `console` is this process's stdout, and the leg then failed with
   * `Unexpected token s in JSON at position 1` — a message that names neither smoldot nor
   * logging nor the boot it had just completed. The run had taken 348 seconds and succeeded.
   *
   * So the report gets a channel nothing else can write to, and stdout goes back to being
   * what it is: where a person reads what happened. The failure mode becomes *the report file
   * was not written*, which points at the step that did not finish.
   */
  const reportPath = argOf(argv, 'report');
  if (reportPath !== undefined) writeFileSync(reportPath, report, { mode: 0o600 });
  process.stdout.write(report);
  // Explicit, for the reason the bounded teardown above gives: a live smoldot worker thread
  // keeps the event loop alive, so a run that has already produced its report would otherwise
  // hang instead of exiting — and a drill that hangs after passing reads as one that failed.
  process.exit(0);
}
