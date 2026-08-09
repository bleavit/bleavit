/**
 * Run the 11 §11.9 funding read path against a live topology — F18; 02 §7.7; 15 §4.8.
 *
 * `openWithdrawLeg` and `openDepositLeg` had **no production caller and no live caller**: every
 * test drives them over fakes, so the two frozen Asset Hub reads, the two local reads and the
 * four storage keys behind them had never once been built from real metadata and answered by a
 * real chain. This is the caller that closes that, in the same shape `boot.ts` gave 10 §5.2's
 * classifier.
 *
 * ## Withdraw first, and that ordering is 02 §7.7 written as an execution order
 *
 * §7.7's closing sentence is that a withdraw *"is unaffected"* by an unavailable Asset Hub —
 * it is a local `pallet_xcm` call over §7.4 reads. §11.9.2 says the same. A drill that ran
 * deposit first and stopped on its verdict would never have exercised the leg that is supposed
 * to survive it, which is the half worth proving: this run reports a `ready` withdraw beside
 * whatever the deposit leg did, and a withdraw that failed *because* Asset Hub failed would be
 * visible as both legs blocking together.
 *
 * ## Every value handed to a read comes from the runtime's own published bytes
 *
 * `runtime/bleavit-runtime/fixtures/storage-keys.json` publishes the `ForeignAssets.Account`
 * key together with its two **pre-images**, so the USDC XCM `Location`, the account, and — via
 * the Location's own `GeneralIndex` junction — the Asset Hub asset index are all *decoded* here
 * rather than typed (R-2). 02 §7.7 states that derivation itself: §8's Location *"decodes to
 * pallet instance 50 — `Assets` — asset 1337, on parachain 1000"*, so reading the index out of
 * the Location is the contract's own reading rather than a shortcut.
 *
 * The account is decoded **twice**, once per chain's own codec. Both chains address the same 32
 * bytes and render them differently (ss58 prefix 7777 here, 42 on Asset Hub), so one string
 * passed to both would encode correctly for one chain and be a key for nothing on the other —
 * the silent failure `funding-reads.ts` names: *"a well-formed key for the wrong entry returns
 * no value, and no value renders as 0 USDC"*.
 *
 * What is **not** derivable is stated as such. `amount`, the two fee estimates and the USDC
 * `min_balance` are a user's intent and a 02 §8 release pin; this chain publishes none of them
 * and the four frozen surfaces do not carry them. They are therefore required command-line
 * arguments with no defaults — the discipline `DepositReadParams` already applies to
 * `assetId` — and the report keeps them under `driverInputs`, never beside the reads, so
 * nothing can read the output as if the chain had stated them.
 *
 * ## Usage
 *
 * ```sh
 * node app/tools/drill-client/funding.ts \
 *   --pin <dev-pin.json> --relay-bootnodes <multiaddr,…> --para-bootnodes <…> \
 *   [--asset-hub-bootnodes <…>] \
 *   --amount <u128> --asset-hub-fee <u128> --local-fee <u128> --usdc-min-balance <u128> \
 *   [--timeout-seconds 300] [--asset-hub-deadline-seconds 120] --report <file>
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bleavit, assethub_paseo } from '@polkadot-api/descriptors';
import {
  FinalizedReader,
  loadCodecs,
  loadMetadata,
  type AssetHubConnection,
  type BundledChain,
  type ChainHeadTransport,
  type RuntimeVersionReport,
} from '@bleavit/chain-client';
import { startNodeLightClient } from '@bleavit/chain-client/node-light-client';
import type { LightClient } from '@bleavit/chain-client/light-client';
import {
  classifyAssetHubFor,
  fundingArtifacts,
  openDepositLeg,
  openWithdrawLeg,
  type DepositBlockCause,
  type ForeignVerdict,
  type FundingArtifacts,
  type FundingPins,
} from '@bleavit/application';
import {
  FUNDING_READS,
  depositBlocks,
  readDepositInputs,
  readWithdrawInputs,
  withdrawBlocks,
  type FundingChain,
  type FundingChains,
} from '@bleavit/features-tx';
import { assetHubLabel } from './foreign-label.ts';

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

export class DrillFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrillFundingError';
  }
}

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function argOf(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function required(argv: readonly string[], name: string): string {
  const value = argOf(argv, name);
  if (value === undefined) throw new DrillFundingError(`--${name} is required and takes a value`);
  return value;
}

/**
 * A `u128` argument, required and never defaulted.
 *
 * `BigInt('')` is `0n` and `BigInt(' 12 ')` is `12n`, so a mistyped flag would otherwise become
 * a plausible amount rather than an error — and a zero amount passes every arithmetic check
 * §11.9.1 makes, which is the worst way for a drill input to be wrong.
 */
export function amountArg(argv: readonly string[], name: string): bigint {
  const raw = required(argv, name);
  if (!/^[0-9]+$/.test(raw)) {
    throw new DrillFundingError(`--${name} must be a non-negative integer in base units, got ${JSON.stringify(raw)}`);
  }
  return BigInt(raw);
}

function addresses(argv: readonly string[], name: string): readonly string[] {
  const raw = argOf(argv, name);
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function bundled(role: { pinned: DevPinRole; chainSpec: string }): BundledChain {
  return { pinned: role.pinned as BundledChain['pinned'], chainSpec: role.chainSpec };
}

/** One published storage key together with the pre-images that produced it. */
interface PublishedKey {
  readonly name: string;
  readonly pallet: string;
  readonly item: string;
  readonly preimages: readonly string[];
  readonly key: string;
}

/**
 * The runtime's own published `ForeignAssets.Account` key — the single source for this run.
 *
 * Read from `runtime/bleavit-runtime/fixtures/storage-keys.json`, which is generated from the
 * runtime rather than written by hand, so nothing below is a value this file chose.
 */
export function publishedForeignAssetsKey(fixtureText: string): PublishedKey {
  const fixture = JSON.parse(fixtureText) as { schema?: string; entries?: readonly PublishedKey[] };
  if (fixture.schema !== 'bleavit.storage-keys.v1') {
    throw new DrillFundingError(`unexpected storage-key fixture schema ${JSON.stringify(fixture.schema)}`);
  }
  const entry = (fixture.entries ?? []).find((each) => each.name === 'foreign_assets_account');
  if (entry === undefined) {
    throw new DrillFundingError('the runtime fixture no longer publishes "foreign_assets_account"');
  }
  if (entry.preimages.length < 2) {
    throw new DrillFundingError('"foreign_assets_account" publishes fewer than two pre-images');
  }
  return entry;
}

/** The per-position codecs a storage item's key is built from, as PAPI exposes them. */
function keyCodecs(chain: FundingChain, pallet: string, item: string): readonly { dec(raw: string): unknown }[] {
  const query = (chain.codecs as { query?: Record<string, Record<string, unknown> | undefined> }).query;
  const entry = query?.[pallet]?.[item] as { args?: { inner?: unknown } } | undefined;
  const inner = entry?.args?.inner;
  if (!Array.isArray(inner)) {
    throw new DrillFundingError(`${pallet}.${item} exposes no per-position key codecs on this chain`);
  }
  return inner as readonly { dec(raw: string): unknown }[];
}

/**
 * The Asset Hub asset index, read out of the USDC `Location` — 02 §7.7, §8.
 *
 * *"`X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337))` decodes to pallet instance 50
 * — `Assets` — asset 1337, on parachain 1000"*. So the index is not a second pin beside the
 * Location; it is a projection of it, and taking it from anywhere else would be a value that
 * could drift from the Location the local key is built with.
 *
 * Written against the decoded shape rather than the codec, because the interior is a versioned
 * enum whose junction list is what carries the answer. A Location with no `GeneralIndex` is
 * refused rather than defaulted: this release would then be pinning an asset it cannot name.
 */
export function assetIndexOfLocation(location: unknown): number {
  const interior = (location as { interior?: { value?: unknown } } | undefined)?.interior?.value;
  const junctions = Array.isArray(interior) ? interior : [interior];
  for (const junction of junctions) {
    const typed = junction as { type?: unknown; value?: unknown } | undefined;
    if (typed?.type !== 'GeneralIndex') continue;
    const index = typed.value;
    if (typeof index !== 'bigint' && typeof index !== 'number') {
      throw new DrillFundingError(`the USDC Location's GeneralIndex is ${typeof index}, not a number`);
    }
    const asNumber = Number(index);
    if (!Number.isSafeInteger(asNumber) || asNumber < 0) {
      throw new DrillFundingError(`the USDC Location's GeneralIndex ${String(index)} is not a u32 asset index`);
    }
    return asNumber;
  }
  throw new DrillFundingError(
    'the USDC Location carries no GeneralIndex junction, so this release cannot name the ' +
      'Asset Hub asset the deposit leg reads (02 §7.7, §8)',
  );
}

/** What each leg read, reported per surface so an empty answer is distinguishable from a zero. */
interface ReadReport {
  readonly surface: string;
  readonly key: string;
  readonly decoded: string | undefined;
}

export interface FundingDrillReport {
  readonly mode: 'funding';
  /** Values this drill supplied. Never chain reads — see this module's header. */
  readonly driverInputs: {
    readonly amount: string;
    readonly assetHubFee: string;
    readonly localFee: string;
    readonly usdcMinBalance: string;
    readonly assetId: number;
    readonly whoLocal: string;
    readonly whoAssetHub: string;
  };
  /** The published key this run rebuilt from the runtime's own pre-images, and its agreement. */
  readonly publishedKeyAgrees: boolean;
  readonly withdraw:
    | {
        readonly kind: 'ready';
        readonly chain: string;
        readonly blockNumber: number;
        readonly reads: readonly ReadReport[];
        readonly undecodable: readonly string[];
        readonly blocks: readonly string[];
      }
    | { readonly kind: 'blocked'; readonly reason: string };
  readonly deposit:
    | {
        readonly kind: 'ready';
        readonly localChain: string;
        readonly assetHubChain: string;
        readonly localBlockNumber: number;
        readonly assetHubBlockNumber: number;
        readonly foreignMode: string;
        readonly foreignReason: string | undefined;
        readonly reads: readonly ReadReport[];
        readonly undecodable: readonly string[];
        readonly blocks: readonly string[];
      }
    /**
     * The **cause** rides beside the reason, because only two causes are environmental.
     *
     * 02 §7.7 requires an absent or unpinned Asset Hub to block the flow with diagnostics, so the
     * drill harness accepts those two at its lower tier and refuses every other cause at both.
     * `reason` is a sentence written for a person; matching it is how a **local** reader that
     * failed to open passed as the documented refusal, and drill 14 went green having read one
     * chain.
     *
     * **A blocked leg of any cause certifies nothing**, and the harness — not this report — is
     * where that is decided. `openDepositLeg` returns both environmental refusals before it opens
     * the Asset Hub reader, before `fundingReaders` and before `classifyAssetHub`, so none of the
     * three things 15 §4.8 says this row certifies has happened by the time this arm is built.
     * The fields the harness reads that claim off are on the `ready` arm above, which is why
     * they are there and not here.
     */
    | { readonly kind: 'blocked'; readonly cause: DepositBlockCause; readonly reason: string };
}

function stage(name: string): void {
  process.stderr.write(`[drill-funding] ${name}\n`);
}

/** The four artifacts, the three derived pins and the two account renderings. */
export interface FundingSetup {
  readonly chains: FundingChains;
  readonly artifacts: FundingArtifacts;
  readonly pins: FundingPins;
  readonly assetId: number;
  readonly whoLocal: string;
  readonly whoAssetHub: string;
  readonly publishedKeyAgrees: boolean;
}

/**
 * Build everything that reaches no network — deliberately before any chain is started.
 *
 * `fundingArtifacts` refuses a chain whose metadata and descriptors disagree on a storage
 * item's hasher count, so a packaging defect surfaces here rather than after a sync.
 */
export async function fundingSetup(assetHub: BundledChain, fixtureText: string): Promise<FundingSetup> {
  const chains: FundingChains = {
    local: {
      codecs: await loadCodecs(bleavit),
      metadata: loadMetadata(readFileSync(join(APP, 'fixtures', 'chain-feed', '2', 'metadata.scale'))),
    },
    assetHub: {
      codecs: await loadCodecs(assethub_paseo),
      metadata: loadMetadata(
        readFileSync(join(APP, 'fixtures', 'foreign-chain-feed', 'asset-hub-paseo', '2004002', 'metadata.scale')),
      ),
    },
  };

  const published = publishedForeignAssetsKey(fixtureText);
  const localKeyCodecs = keyCodecs(chains.local, published.pallet, published.item);
  const usdcLocation = localKeyCodecs[0]?.dec(published.preimages[0] ?? '0x');
  const whoLocal = localKeyCodecs[1]?.dec(published.preimages[1] ?? '0x');
  const assetHubKeyCodecs = keyCodecs(chains.assetHub, 'Assets', 'Account');
  const whoAssetHub = assetHubKeyCodecs[1]?.dec(published.preimages[1] ?? '0x');
  if (typeof whoLocal !== 'string' || typeof whoAssetHub !== 'string') {
    throw new DrillFundingError('the published account pre-image did not decode to an address on both chains');
  }

  const pins: FundingPins = { assetHub, usdcLocation };
  const artifacts = fundingArtifacts(chains, pins);
  return {
    chains,
    artifacts,
    pins,
    assetId: assetIndexOfLocation(usdcLocation),
    whoLocal,
    whoAssetHub,
    // The one property this run can check against the runtime without a chain: the key this
    // client builds from the published pre-images is byte-for-byte the key the runtime
    // published. It is asserted here rather than in the report alone, because a mismatch means
    // every read below asked the chain about the wrong entry — and an empty answer to the
    // wrong key is indistinguishable from an honest zero balance.
    publishedKeyAgrees: artifacts.keys.localFreeUsdc(whoLocal).toLowerCase() === published.key.toLowerCase(),
  };
}

function reported(surface: string, key: string, decoded: string | undefined): ReadReport {
  return { surface, key, decoded };
}

/**
 * Exactly what the funding path needs from a chain connection — nothing else.
 *
 * Narrower than `LightClient` deliberately, and the narrowing is what makes this whole driver
 * drivable per commit: a fake satisfying `LightClient` would have to supply a `Topology` and
 * two compat providers that this path never reaches, so the suite would either be enormous or
 * would reach for a cast — and a cast at the seam is indistinguishable from having never
 * checked. It also states the dependency honestly: the deposit leg needs a transport, a lazy
 * Asset Hub connector and 10 §5.2's foreign verdict, and the withdraw leg needs the first alone.
 *
 * `classifyAssetHub` is a member rather than a separate dependency because it is a function
 * *of* this connection — `classifyAssetHubFor` opens a second, transient handle on the same
 * smoldot instance — so a caller holding no connection has nothing to classify.
 */
export interface FundingConnection {
  readonly transport: ChainHeadTransport;
  connectAssetHub(
    assetHub: BundledChain,
    options?: { readonly deadlineMs?: number },
  ): Promise<AssetHubConnection<ChainHeadTransport>>;
  classifyAssetHub(
    assetHub: BundledChain,
    runtime: RuntimeVersionReport | undefined,
  ): Promise<ForeignVerdict>;
  stop(): Promise<void>;
}

/** Everything the live run needs, injected — so `main` is drivable without a chain. */
export interface FundingDeps {
  readonly start: (document: DevPinDocument, bootnodes: Bootnodes) => Promise<FundingConnection>;
  readonly fixtureText: string;
}

export interface Bootnodes {
  readonly relay: readonly string[];
  readonly para: readonly string[];
  readonly assetHub: readonly string[];
}

export interface FundingRunOptions {
  readonly amount: bigint;
  readonly assetHubFee: bigint;
  readonly localFee: bigint;
  readonly usdcMinBalance: bigint;
  readonly assetHubDeadlineMs: number;
  /** How long a leg waits for its chain's first finalized block — see {@link withDeadline}. */
  readonly readerDeadlineMs: number;
}

/**
 * Bound an await that would otherwise never end — and this one genuinely would.
 *
 * `FinalizedReader.open` awaits `transport.pinnedBlock()`, which resolves on the follow
 * subscription's first `finalized` event. A parachain whose relay linkage never forms produces
 * none, ever, so an unbounded open is a drill that hangs rather than reports — the failure mode
 * `boot.ts` already bounds for the same reason, and one that reads as a stuck machine rather
 * than as an unreachable peer set.
 *
 * A wrapper, not a cancellation, and the distinction matters less here than it does in
 * `assetHubConnector.connect`: that one had to abandon its attempt because E17's *"retry AH
 * sync"* must be able to start a new one afterwards. This process has no retry and no screen —
 * it writes a report and exits — so abandoning the wait is the whole of what is needed, and
 * the reader that lands afterwards dies with the worker.
 */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DrillFundingError(`no ${what} arrived within ${Math.round(ms / 1000)}s`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function runFunding(
  document: DevPinDocument,
  bootnodes: Bootnodes,
  options: FundingRunOptions,
  deps: FundingDeps,
): Promise<FundingDrillReport> {
  if (document.assetHub === undefined) {
    throw new DrillFundingError(
      'the pin document carries no Asset Hub role. The deposit leg is the whole of 02 §7.7 and ' +
        'cannot be exercised without one; rebuild the pin with --asset-hub.',
    );
  }
  const assetHub = bundled(document.assetHub);

  stage('building keys and decoders from committed artifacts');
  const setup = await fundingSetup(assetHub, deps.fixtureText);

  stage('starting the light client');
  const client = await deps.start(document, bootnodes);
  try {
    // Bounded, so a chain that never finalizes becomes a `blocked` leg carrying that sentence
    // rather than a drill that stops producing output. Both legs already turn a throw from here
    // into `blocked`, so this exercises their real recovery path instead of adding one.
    const openReader = (transport: ChainHeadTransport): Promise<FinalizedReader> =>
      withDeadline(FinalizedReader.open(transport), options.readerDeadlineMs, 'finalized block');

    // **Withdraw first** — see this module's header. It takes no Asset Hub connector at all.
    stage('opening the withdraw leg (11 §11.9.2 — local chain only)');
    const withdraw = await openWithdrawLeg({
      local: client.transport,
      openReader,
      artifacts: setup.artifacts,
    });
    let withdrawReport: FundingDrillReport['withdraw'];
    if (withdraw.kind === 'blocked') {
      withdrawReport = { kind: 'blocked', reason: withdraw.reason };
    } else {
      stage(`withdraw reader at ${withdraw.reader.at.chain} #${withdraw.reader.at.blockNumber}`);
      const read = await readWithdrawInputs(withdraw.reader, setup.artifacts.keys, setup.artifacts.decoders, {
        who: setup.whoLocal,
        amount: options.amount,
        localFee: options.localFee,
        minBalance: options.usdcMinBalance,
        ledgerFrozen: false,
        // Deliberately `undefined`: §11.9.2 makes the Asset Hub destination check degrade to a
        // warning, and this leg has no Asset Hub reader to establish it with. `undefined` is
        // that third state, and `destinationWarning` renders it as "not checked".
        destinationViable: undefined,
      });
      withdrawReport = {
        kind: 'ready',
        chain: withdraw.reader.at.chain,
        blockNumber: withdraw.reader.at.blockNumber,
        reads: [
          reported(
            FUNDING_READS.local.freeUsdc,
            setup.artifacts.keys.localFreeUsdc(setup.whoLocal),
            read.inputs.freeBalance === undefined ? undefined : String(read.inputs.freeBalance.value),
          ),
        ],
        undecodable: read.undecodable.map((entry) => `${entry.label}: ${entry.reason}`),
        blocks: withdrawBlocks(read.inputs).map((block) => `${block.check}: ${block.detail}`),
      };
    }

    stage('opening the deposit leg (11 §11.9.1 — both chains)');
    const deposit = await openDepositLeg({
      local: client.transport,
      openReader,
      artifacts: setup.artifacts,
      pins: setup.pins,
      connectAssetHub: (bundle, connectOptions) => client.connectAssetHub(bundle, connectOptions),
      assetHubDeadlineMs: options.assetHubDeadlineMs,
      classifyAssetHub: (bundle, runtime) => client.classifyAssetHub(bundle, runtime),
    });
    let depositReport: FundingDrillReport['deposit'];
    if (deposit.kind === 'blocked') {
      depositReport = { kind: 'blocked', cause: deposit.cause, reason: deposit.reason };
    } else {
      const { local, assetHub: assetHubReader } = deposit.readers;
      stage(`deposit readers at ${local.at.chain} #${local.at.blockNumber} / ${assetHubReader.at.chain} #${assetHubReader.at.blockNumber}`);
      const foreign = deposit.foreign;
      const read = await readDepositInputs(deposit.readers, setup.artifacts.keys, setup.artifacts.decoders, {
        who: setup.whoAssetHub,
        assetId: setup.assetId,
        amount: options.amount,
        assetHubFee: options.assetHubFee,
        minBalance: options.usdcMinBalance,
        xcmHealthy: true,
        // 10 §5.2's **foreign** verdict, and nothing else may fill this in.
        assetHubCompatible: foreign.kind === 'classified' && foreign.classification.mode === 'full',
        // `caps` is deliberately absent: D-13's headroom is read through the constitution
        // surface, which this drill does not open, and `depositBlocks` blocks on the absence.
        // Supplying a fabricated headroom would turn a real block into a green line.
      });
      depositReport = {
        kind: 'ready',
        localChain: local.at.chain,
        assetHubChain: assetHubReader.at.chain,
        localBlockNumber: local.at.blockNumber,
        assetHubBlockNumber: assetHubReader.at.blockNumber,
        foreignMode: foreign.kind === 'classified' ? foreign.classification.mode : 'unestablished',
        foreignReason: foreign.kind === 'classified' ? foreign.classification.reason : foreign.reason,
        reads: [
          reported(
            FUNDING_READS.assetHub.usdc,
            setup.artifacts.keys.assetHubUsdc(setup.assetId, setup.whoAssetHub),
            read.inputs.assetHubBalance === undefined ? undefined : String(read.inputs.assetHubBalance.value),
          ),
          reported(
            FUNDING_READS.assetHub.account,
            setup.artifacts.keys.assetHubAccount(setup.whoAssetHub),
            // `assetHubReady` folds the account's viability together with the compat verdict,
            // so it is reported as the pair rather than as a balance it never was.
            `assetHubReady=${read.inputs.assetHubReady}`,
          ),
          reported(
            FUNDING_READS.local.phaseFlags,
            setup.artifacts.keys.phaseFlags(),
            `sudoPresent=${read.inputs.bootstrapPhase}`,
          ),
        ],
        undecodable: read.undecodable.map((entry) => `${entry.label}: ${entry.reason}`),
        blocks: depositBlocks(read.inputs).map((block) => `${block.check}: ${block.detail}`),
      };
    }

    return {
      mode: 'funding',
      driverInputs: {
        amount: String(options.amount),
        assetHubFee: String(options.assetHubFee),
        localFee: String(options.localFee),
        usdcMinBalance: String(options.usdcMinBalance),
        assetId: setup.assetId,
        whoLocal: setup.whoLocal,
        whoAssetHub: setup.whoAssetHub,
      },
      publishedKeyAgrees: setup.publishedKeyAgrees,
      withdraw: withdrawReport,
      deposit: depositReport,
    };
  } finally {
    // Bounded, for the reason `boot.ts` gives: a worker inside a long synchronous WASM
    // computation cannot be interrupted, and the evidence is the report rather than a politely
    // released thread.
    stage('stopping');
    await Promise.race([client.stop(), new Promise<void>((resolve) => setTimeout(resolve, 15_000))]);
    stage('stopped');
  }
}

/**
 * The one implementation that names smoldot — the same seam `chain-session.ts` draws.
 *
 * All three chains' peers are unioned onto every spec `startTopology` dials: a peer that does
 * not serve a chain is simply not useful for it, and the Asset Hub set being dropped is what
 * left its chain dialling peers that do not serve it (F27's R-6 finding).
 */
const liveDeps = (): FundingDeps => ({
  fixtureText: readFileSync(join(APP, '..', 'runtime', 'bleavit-runtime', 'fixtures', 'storage-keys.json'), 'utf8'),
  start: async (document, bootnodes) => {
    const client: LightClient = await startNodeLightClient({
      relay: bundled(document.relay),
      para: bundled(document.para),
      extraBootnodes: [...bootnodes.relay, ...bootnodes.para, ...bootnodes.assetHub],
    });
    return {
      transport: client.transport,
      connectAssetHub: (assetHub, connectOptions) => client.connectAssetHub(assetHub, connectOptions),
      // The label is the **pin's**, never the connected spec's id — see `foreign-label.ts`.
      classifyAssetHub: (assetHub, runtime) =>
        classifyAssetHubFor(client, assetHub, assetHubLabel(), runtime),
      stop: () => client.stop(),
    };
  },
});

export async function main(argv: readonly string[], deps?: FundingDeps): Promise<string> {
  const document = JSON.parse(readFileSync(required(argv, 'pin'), 'utf8')) as DevPinDocument;
  if (document.schema !== 'bleavit.dev-chain-pin.v1') {
    throw new DrillFundingError(`unexpected pin schema ${JSON.stringify(document.schema)}`);
  }
  const timeoutSeconds = Number(argOf(argv, 'timeout-seconds') ?? '300');
  const assetHubDeadlineSeconds = Number(argOf(argv, 'asset-hub-deadline-seconds') ?? '120');
  for (const [name, value] of [
    ['timeout-seconds', timeoutSeconds],
    ['asset-hub-deadline-seconds', assetHubDeadlineSeconds],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new DrillFundingError(`--${name} must be a positive number`);
  }

  const report = await runFunding(
    document,
    {
      relay: addresses(argv, 'relay-bootnodes'),
      para: addresses(argv, 'para-bootnodes'),
      assetHub: addresses(argv, 'asset-hub-bootnodes'),
    },
    {
      amount: amountArg(argv, 'amount'),
      assetHubFee: amountArg(argv, 'asset-hub-fee'),
      localFee: amountArg(argv, 'local-fee'),
      usdcMinBalance: amountArg(argv, 'usdc-min-balance'),
      assetHubDeadlineMs: assetHubDeadlineSeconds * 1000,
      readerDeadlineMs: timeoutSeconds * 1000,
    },
    deps ?? liveDeps(),
  );
  return `${JSON.stringify(report, null, 2)}\n`;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const argv = process.argv.slice(2);
  const report = await main(argv);
  // The report goes to its own file — stdout is shared with smoldot's log callback, which
  // writes from a worker thread and turned `boot.ts`'s successful 348-second run into a JSON
  // parse error. See that file's closing comment.
  const reportPath = argOf(argv, 'report');
  if (reportPath !== undefined) writeFileSync(reportPath, report, { mode: 0o600 });
  process.stdout.write(report);
  process.exit(0);
}
