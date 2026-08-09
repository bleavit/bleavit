/**
 * The funding drill driver, without a chain — F18; 11 §11.9; 02 §7.7.
 *
 * The drill leg itself runs at the release tier. What is checkable per commit is everything the
 * driver decides before and after the two light-client calls, and three of those decisions are
 * the substance of the milestone:
 *
 *  - **every value handed to a read is decoded from the runtime's own published bytes.** The
 *    USDC `Location`, the account in each chain's own address format, and the Asset Hub asset
 *    index — the last read out of the Location's `GeneralIndex` junction, which is the
 *    derivation 02 §7.7 itself states. The suite proves the key that comes out is byte-for-byte
 *    the key the runtime published, using **real** codecs and **real** metadata.
 *  - **withdraw does not depend on Asset Hub.** §11.9.2 and §7.7 both say so, and a connector
 *    that refuses everything must still leave the withdraw leg `ready`.
 *  - **a leg is never `ready` without having read something.** That is the outcome the whole
 *    drill exists to make impossible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AssetHubConnection,
  BundledChain,
  ChainHeadTransport,
  FinalizedBlockRef,
  RuntimeVersionReport,
  StorageItem,
} from '@bleavit/chain-client';
import { foreignIdentityVerdict, type ForeignVerdict } from '@bleavit/application';

import { assetHubLabel } from '../../tools/drill-client/foreign-label.ts';
import {
  DrillFundingError,
  amountArg,
  assetIndexOfLocation,
  fundingSetup,
  publishedForeignAssetsKey,
  runFunding,
  type Bootnodes,
  type FundingConnection,
  type FundingDeps,
  type FundingRunOptions,
} from '../../tools/drill-client/funding.ts';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = readFileSync(join(APP, '..', 'runtime', 'bleavit-runtime', 'fixtures', 'storage-keys.json'), 'utf8');

const LOCAL_CHAIN = `0x${'ce'.repeat(32)}` as const;
const AH_CHAIN = `0x${'a5'.repeat(32)}` as const;
const BLOCK = `0x${'11'.repeat(32)}` as const;

const RUNTIME: RuntimeVersionReport = {
  specName: 'bleavit',
  specVersion: 2,
  implVersion: 0,
  transactionVersion: 1,
};

const AH_BUNDLE: BundledChain = {
  pinned: {
    id: 'asset-hub-paseo-local',
    kind: 'para',
    sha256: `0x${'cc'.repeat(32)}`,
    genesisHash: AH_CHAIN,
    relayChainId: 'paseo-local',
  },
  chainSpec: '{}',
};

function pinDocument(withAssetHub = true) {
  return {
    schema: 'bleavit.dev-chain-pin.v1',
    relay: {
      pinned: { id: 'paseo-local', kind: 'relay' as const, sha256: BLOCK, genesisHash: BLOCK },
      chainSpec: '{}',
    },
    para: {
      pinned: {
        id: 'bleavit_local_drills',
        kind: 'para' as const,
        sha256: BLOCK,
        genesisHash: LOCAL_CHAIN,
        relayChainId: 'paseo-local',
      },
      chainSpec: '{}',
    },
    ...(withAssetHub ? { assetHub: { pinned: AH_BUNDLE.pinned, chainSpec: AH_BUNDLE.chainSpec } } : {}),
  };
}

/** A transport that answers every storage read with nothing — an absent entry, a real zero. */
function transport(chain: string, values: Readonly<Record<string, string>> = {}): ChainHeadTransport {
  const at: FinalizedBlockRef = { chain: chain as FinalizedBlockRef['chain'], blockHash: BLOCK, blockNumber: 7 };
  return {
    finalizedRuntime: () => RUNTIME,
    async pinnedBlock() {
      return at;
    },
    async storage(_at, key): Promise<readonly StorageItem[]> {
      const value = values[key.toLowerCase()];
      return value === undefined ? [{ key }] : [{ key, value }];
    },
    async call() {
      return '0x';
    },
  };
}

const CLASSIFIED_WRONG_CHAIN: ForeignVerdict = {
  kind: 'classified',
  classification: {
    domain: 'foreign',
    chain: 'Asset Hub',
    mode: 'wrong-chain',
    specVersion: 2004002,
    disabled: [],
    proven: [],
    reason: 'a different chain',
  },
  codeHash: undefined,
};

interface ConnectionOverrides {
  readonly local?: ChainHeadTransport;
  readonly assetHub?: AssetHubConnection<ChainHeadTransport>;
  readonly verdict?: ForeignVerdict;
}

/** A connection that records its own teardown, because a leaked light client is silent. */
interface CountingConnection extends FundingConnection {
  readonly stops: { count: number };
}

function connection(overrides: ConnectionOverrides = {}): CountingConnection {
  const stops = { count: 0 };
  return {
    stops,
    transport: overrides.local ?? transport(LOCAL_CHAIN),
    async connectAssetHub() {
      return overrides.assetHub ?? { kind: 'attached', transport: transport(AH_CHAIN), genesisHash: AH_CHAIN };
    },
    async classifyAssetHub() {
      return overrides.verdict ?? CLASSIFIED_WRONG_CHAIN;
    },
    async stop() {
      stops.count += 1;
    },
  };
}

const OPTIONS: FundingRunOptions = {
  amount: 1_000_000n,
  assetHubFee: 0n,
  localFee: 0n,
  usdcMinBalance: 10_000n,
  assetHubDeadlineMs: 50,
  readerDeadlineMs: 200,
};

const NO_BOOTNODES: Bootnodes = { relay: [], para: [], assetHub: [] };

const deps = (client: FundingConnection): FundingDeps => ({
  fixtureText: FIXTURE,
  start: async () => client,
});

/* ------------------------------------- every read input comes from the runtime's own bytes */

test('the key this driver builds is byte-for-byte the key the runtime published', async () => {
  // The single property that makes every read below meaningful. A well-formed key for the wrong
  // entry returns no value, and no value renders as a zero balance — so a mismatch here would be
  // invisible in the report and everywhere downstream of it.
  const setup = await fundingSetup(AH_BUNDLE, FIXTURE);
  assert.equal(setup.publishedKeyAgrees, true);
  const published = publishedForeignAssetsKey(FIXTURE);
  assert.equal(setup.artifacts.keys.localFreeUsdc(setup.whoLocal).toLowerCase(), published.key.toLowerCase());
});

test('the asset index is read out of the Location, not written beside it', async () => {
  // 02 §7.7: `X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337))` *"decodes to pallet
  // instance 50 — `Assets` — asset 1337, on parachain 1000"*. A second pin carrying the number
  // would be one that could drift from the Location the local key is built with.
  const setup = await fundingSetup(AH_BUNDLE, FIXTURE);
  assert.equal(setup.assetId, 1337);
});

test('a Location with no GeneralIndex is refused rather than defaulted', () => {
  // This release would then be pinning an Asset Hub asset it cannot name.
  for (const location of [
    { parents: 1, interior: { type: 'Here', value: undefined } },
    { parents: 1, interior: { type: 'X1', value: [{ type: 'Parachain', value: 1000 }] } },
    undefined,
  ]) {
    assert.throws(() => assetIndexOfLocation(location), DrillFundingError, JSON.stringify(location));
  }
  assert.equal(assetIndexOfLocation({ interior: { value: [{ type: 'GeneralIndex', value: 7n }] } }), 7);
});

test('the account is rendered in EACH chain\'s own address format', async () => {
  // ss58 prefix 7777 here, 42 on Asset Hub, over the same 32 published bytes. One string passed
  // to both would encode for one chain and be a key for nothing on the other.
  const setup = await fundingSetup(AH_BUNDLE, FIXTURE);
  assert.notEqual(setup.whoLocal, setup.whoAssetHub);
  assert.ok(setup.whoLocal.length > 0 && setup.whoAssetHub.length > 0);
});

test('a fixture that stopped publishing the key is loud rather than silently unused', () => {
  assert.throws(() => publishedForeignAssetsKey('{"schema":"other"}'), /unexpected storage-key fixture schema/);
  assert.throws(
    () => publishedForeignAssetsKey('{"schema":"bleavit.storage-keys.v1","entries":[]}'),
    /no longer publishes "foreign_assets_account"/,
  );
});

/* ------------------------------------------------------------- the two legs, over fake chains */

test('both legs read, and each leaf carries its own chain\'s pin', async () => {
  const report = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, deps(connection()));

  assert.equal(report.withdraw.kind, 'ready');
  if (report.withdraw.kind !== 'ready') return;
  assert.equal(report.withdraw.chain, LOCAL_CHAIN);
  assert.equal(report.withdraw.reads.length, 1);
  assert.equal(report.withdraw.reads[0]?.surface, 'ForeignAssets.Account');
  // An absent account is a real zero the chain did state, and it stays badged.
  assert.equal(report.withdraw.reads[0]?.decoded, '0');

  assert.equal(report.deposit.kind, 'ready');
  if (report.deposit.kind !== 'ready') return;
  assert.equal(report.deposit.localChain, LOCAL_CHAIN);
  assert.equal(report.deposit.assetHubChain, AH_CHAIN);
  assert.deepEqual(
    report.deposit.reads.map((read) => read.surface),
    ['Assets.Account', 'System.Account', 'Constitution.PhaseFlags'],
  );
  assert.equal(report.publishedKeyAgrees, true);
});

test('withdraw stays ready when the Asset Hub connector refuses everything (02 §7.7)', async () => {
  // The asymmetry, as an execution order: §7.7's closing sentence is that a withdraw *"is
  // unaffected"*, and this is the only place in the repository where that is exercised end to
  // end rather than asserted about a signature.
  const report = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ assetHub: { kind: 'unavailable', reason: 'Asset Hub never synced.' } })),
  );
  assert.equal(report.withdraw.kind, 'ready');
  assert.equal(report.deposit.kind, 'blocked');
  if (report.deposit.kind !== 'blocked') return;
  assert.match(report.deposit.reason, /Asset Hub never synced/);
});

test('a blocked deposit reports WHICH side refused, because only one side is excused', async () => {
  // The harness has this report and nothing else to decide on, and 15 §4.8 excuses exactly one
  // blocked cause in a Zombienet topology: 02 §7.7 pins the Asset Hub of the relay a release
  // targets, so a locally generated one is absent or unpinned by construction. The report used
  // to carry only `reason`, a sentence written for a person — so a **local** reader that failed
  // to open read as that documented refusal and drill 14 passed without ever completing the
  // two-chain read path it advertises.
  const refused = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ assetHub: { kind: 'unavailable', reason: 'Asset Hub never synced.' } })),
  );
  assert.equal(refused.deposit.kind, 'blocked');
  if (refused.deposit.kind !== 'blocked') return;
  assert.equal(refused.deposit.cause, 'asset-hub-unavailable');

  // The other side of the same fact. Asset Hub attaches and its reader opens; the **second**
  // local `FinalizedReader.open` is the one that fails, so the withdraw leg above it is `ready`
  // and only the deposit leg blocks — the shape that is indistinguishable from the refusal
  // above unless the report says which side gave way.
  const local = transport(LOCAL_CHAIN);
  let opens = 0;
  const flaky: ChainHeadTransport = {
    ...local,
    async pinnedBlock() {
      opens += 1;
      if (opens > 1) throw new Error('the local follow subscription dropped');
      return local.pinnedBlock();
    },
  };
  const defect = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, deps(connection({ local: flaky })));
  assert.equal(defect.withdraw.kind, 'ready', 'the withdraw leg did not open, so this is not the shape under test');
  assert.equal(defect.deposit.kind, 'blocked');
  if (defect.deposit.kind !== 'blocked') return;
  assert.equal(defect.deposit.cause, 'local-unreadable');
});

test('a wrong-chain Asset Hub leaves the leg READY and blocks the deposit as a row', async () => {
  // §11.9.1 makes *"AH connection synced & descriptors compatible"* a precondition **row**, not
  // a gate: a `restricted` or `wrong-chain` Asset Hub whose readers opened must still produce a
  // screen, with the diagnosis on it. E17 asks for *"blocked with diagnostics"*, and a leg that
  // returned `blocked` here would be a screen the user never sees.
  const report = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, deps(connection()));
  assert.equal(report.deposit.kind, 'ready');
  if (report.deposit.kind !== 'ready') return;
  assert.equal(report.deposit.foreignMode, 'wrong-chain');
  assert.ok(
    report.deposit.blocks.some((block) => block.startsWith('Asset Hub connection')),
    `the foreign verdict did not block the deposit: ${JSON.stringify(report.deposit.blocks)}`,
  );
});

test('the D-13 caps are absent, and `depositBlocks` says so rather than passing', async () => {
  // The headroom is read through the constitution surface, which this driver does not open.
  // Supplying a fabricated figure would turn a real block into a green line, so the drill
  // carries the block instead — a defect it is meant to report, not to paper over.
  // `PhaseFlags` is a little-endian u32, and 17 is `sudo present | shadow mode` — the real
  // bootstrap value V-115 records. Written big-endian it decodes to 285,212,672, whose bit 4 is
  // clear, and the caps would then be skipped in exactly the unsafe direction V-115 names.
  const flags = '0x11000000';
  const setup = await fundingSetup(AH_BUNDLE, FIXTURE);
  const local = transport(LOCAL_CHAIN, { [setup.artifacts.keys.phaseFlags().toLowerCase()]: flags });
  const report = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, deps(connection({ local })));
  assert.equal(report.deposit.kind, 'ready');
  if (report.deposit.kind !== 'ready') return;
  assert.ok(
    report.deposit.blocks.some((block) => block.toLowerCase().includes('cap')),
    `no cap block was reported: ${JSON.stringify(report.deposit.blocks)}`,
  );
});

test('a chain that never finalizes becomes a blocked leg, not a drill that hangs', async () => {
  const never: ChainHeadTransport = {
    finalizedRuntime: () => RUNTIME,
    pinnedBlock: () => new Promise(() => {}),
    async storage() {
      return [];
    },
    async call() {
      return '0x';
    },
  };
  const report = await runFunding(pinDocument(), NO_BOOTNODES, { ...OPTIONS, readerDeadlineMs: 30 }, deps(connection({ local: never })));
  assert.equal(report.withdraw.kind, 'blocked');
  if (report.withdraw.kind !== 'blocked') return;
  assert.match(report.withdraw.reason, /no finalized block arrived within/);
  // And it says which chain, because 11 §11.9.2's whole point is that this is not Asset Hub.
  assert.match(report.withdraw.reason, /not an Asset Hub problem/);
});

test('the light client is stopped even when a leg throws', async () => {
  // A drill process that exits without stopping leaves a WASM worker holding the event loop —
  // and `boot.ts` already records what that costs: a run that has produced its answer hangs
  // instead of exiting, which reads as a failure. The throwing path is the one that skips it.
  const client = connection();
  const exploding: FundingDeps = {
    fixtureText: FIXTURE,
    start: async () => ({
      ...client,
      async connectAssetHub(): Promise<never> {
        throw new Error('the connector was replaced');
      },
    }),
  };
  const report = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, exploding);
  // `openDepositLeg` turns even a throwing connector into a blocked leg, so the run completes…
  assert.equal(report.deposit.kind, 'blocked');
  assert.equal(client.stops.count, 1, 'the light client was not stopped');
});

test('a pin document with no Asset Hub role is refused rather than half-run', async () => {
  // The deposit leg is the whole of 02 §7.7; a run that skipped it would report a funding drill
  // that exercised one chain.
  const client = connection();
  await assert.rejects(
    () => runFunding(pinDocument(false), NO_BOOTNODES, OPTIONS, deps(client)),
    /carries no Asset Hub role/,
  );
  // …and it is refused BEFORE a light client is started, so nothing needs stopping.
  assert.equal(client.stops.count, 0);
});

/* --------------------------------------------- the driver and the harness rule, bound */

/**
 * The rule the drill applies, loaded the way the drill loads it.
 *
 * `drill-harness-rules.test.ts` drives this module over hand-written report shapes and this
 * file drives the producer, and until both were applied to **one** value nothing bound the two:
 * a rule keyed on `deposit.cause` beside a report writing `deposit.blockedBy` leaves both
 * suites green and drill 14 accepting every blocked deposit again. Every assertion below is
 * therefore on a report `runFunding` actually produced.
 */
const harnessRules = createRequire(import.meta.url)(
  join(APP, '..', 'zombienet', 'drills', 'js', 'client-boot-rules.js'),
) as { assertFundingReport(report: unknown): unknown };

/**
 * A local transport whose `PhaseFlags` decodes — 17 = `sudo present | shadow mode`, the real
 * bootstrap value V-115 records, little-endian as the runtime writes it.
 *
 * The bare fake answers that key with nothing, and an absent `PhaseFlags` is undecodable rather
 * than a zero. That is the right client behaviour and the wrong fixture for a test about
 * something else, so the two are kept apart.
 */
async function decodableLocal(): Promise<ChainHeadTransport> {
  const setup = await fundingSetup(AH_BUNDLE, FIXTURE);
  return transport(LOCAL_CHAIN, { [setup.artifacts.keys.phaseFlags().toLowerCase()]: '0x11000000' });
}

test('the harness accepts the refusal 15 §4.8 forces and refuses the local failure beside it', async () => {
  const refused = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ assetHub: { kind: 'unavailable', reason: 'Asset Hub never synced.' }, local: await decodableLocal() })),
  );
  harnessRules.assertFundingReport(refused);

  // Asset Hub attached and read; the second LOCAL open failed. Same `kind`, same nonempty
  // sentence, opposite meaning — and the drill must not report this run as a pass.
  const local = await decodableLocal();
  let opens = 0;
  const defect = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(
      connection({
        local: {
          ...local,
          async pinnedBlock() {
            opens += 1;
            if (opens > 1) throw new Error('the local follow subscription dropped');
            return local.pinnedBlock();
          },
        },
      }),
    ),
  );
  assert.throws(() => harnessRules.assertFundingReport(defect), /not an Asset Hub refusal/);
});

test('the harness refuses a ready report whose reads did not decode', async () => {
  // The default fake answers `PhaseFlags` with nothing, and `readDepositInputs` records that as
  // undecodable rather than as a zero — so this is the producer's own shape, not a fixture
  // written to fail. A run that read three surfaces and could not decode one of them verified
  // nothing about that surface, however many keys it built.
  const blind = await runFunding(pinDocument(), NO_BOOTNODES, OPTIONS, deps(connection()));
  assert.equal(blind.deposit.kind, 'ready');
  if (blind.deposit.kind !== 'ready') return;
  assert.deepEqual(blind.deposit.undecodable, ['Constitution.PhaseFlags: the storage key returned no value']);
  assert.throws(() => harnessRules.assertFundingReport(blind), /could not decode/);

  // The negative control: the same run with a decodable `PhaseFlags` passes, so the rule above
  // is refusing the undecodable read rather than refusing everything.
  const sighted = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ local: await decodableLocal() })),
  );
  assert.equal(sighted.deposit.kind, 'ready');
  if (sighted.deposit.kind !== 'ready') return;
  assert.deepEqual(sighted.deposit.undecodable, []);
  harnessRules.assertFundingReport(sighted);
});

test('the harness refuses the verdict the development-label bug produced', async () => {
  // Both verdicts below come from the **real** classifier over the real pin list, so neither is
  // a mode string somebody typed: `foreignIdentityVerdict` is the same call `classifyAssetHub`
  // makes for a chain whose genesis is not the pinned one, and the only input that differs is
  // the label it is asked about.
  //
  // `asset-hub-paseo-local` is the connected spec's id, which is what `boot.ts` passed until
  // F18. No pin carries that name, so `classifyForeign` answers `unreachable` — *retryable*,
  // where a locally generated Asset Hub is terminally the wrong chain. That is the regression
  // 15 §4.8 says this leg exists to catch, and a nonempty-string rule cannot see it.
  const bugged = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ local: await decodableLocal(), verdict: foreignIdentityVerdict('asset-hub-paseo-local', AH_CHAIN) })),
  );
  assert.equal(bugged.deposit.kind, 'ready');
  if (bugged.deposit.kind !== 'ready') return;
  assert.equal(bugged.deposit.foreignMode, 'unreachable');
  assert.throws(() => harnessRules.assertFundingReport(bugged), /can only ever reach "wrong-chain"/);

  // The negative control, and it is what binds the rule to the topology: asked about the label
  // the pin itself carries, the real classifier returns `wrong-chain` for a locally generated
  // Asset Hub — so the value the harness demands is the value 15 §4.8 says is the only one
  // reachable, rather than a constant that happens to match today.
  const pinned = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ local: await decodableLocal(), verdict: foreignIdentityVerdict(assetHubLabel(), AH_CHAIN) })),
  );
  assert.equal(pinned.deposit.kind, 'ready');
  if (pinned.deposit.kind !== 'ready') return;
  assert.equal(pinned.deposit.foreignMode, 'wrong-chain');
  harnessRules.assertFundingReport(pinned);
});

test('the harness refuses a produced report with a required surface missing', async () => {
  // The drop is applied to a report `runFunding` built, and it is expressed in the producer's
  // own vocabulary — the field is `reads`, the member field is `surface`, and the values are the
  // frozen `FUNDING_READS` names. So a producer that renamed any of the three does not quietly
  // satisfy this test: the intact control at the end stops passing.
  const built = await runFunding(
    pinDocument(),
    NO_BOOTNODES,
    OPTIONS,
    deps(connection({ local: await decodableLocal() })),
  );
  assert.equal(built.deposit.kind, 'ready');
  if (built.deposit.kind !== 'ready') return;
  assert.deepEqual(
    built.deposit.reads.map((read) => read.surface),
    ['Assets.Account', 'System.Account', 'Constitution.PhaseFlags'],
  );

  for (const surface of ['Assets.Account', 'System.Account', 'Constitution.PhaseFlags']) {
    const short = {
      ...built,
      deposit: { ...built.deposit, reads: built.deposit.reads.filter((read) => read.surface !== surface) },
    };
    assert.throws(
      () => harnessRules.assertFundingReport(short),
      new RegExp(`never read ${surface.replace('.', '\\.')}`),
      `a report missing ${surface} was accepted`,
    );
  }

  // The withdraw leg's own required surface, dropped the same way.
  assert.equal(built.withdraw.kind, 'ready');
  if (built.withdraw.kind !== 'ready') return;
  assert.throws(
    () => harnessRules.assertFundingReport({ ...built, withdraw: { ...built.withdraw, reads: [] } }),
    /reported ready with no reads at all/,
  );

  // The intact report the producer built passes, so none of the refusals above refuses
  // everything — and this is the assertion that fails if a surface name ever moves.
  harnessRules.assertFundingReport(built);
});

/* ------------------------------------------------------------------------- the arguments */

test('the four figures the chain cannot state are required, and never parsed loosely', () => {
  // `BigInt('')` is `0n`, and a zero amount passes every arithmetic check §11.9.1 makes — the
  // worst way for a drill input to be wrong, because the run looks like it proved something.
  assert.equal(amountArg(['--amount', '1000000'], 'amount'), 1_000_000n);
  for (const bad of ['', ' 12 ', '-1', '1.5', '0x10', 'lots']) {
    assert.throws(() => amountArg(['--amount', bad], 'amount'), DrillFundingError, `accepted ${JSON.stringify(bad)}`);
  }
  assert.throws(() => amountArg([], 'amount'), /--amount is required/);
});
