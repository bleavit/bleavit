/**
 * S12/S13's wiring — 11 §11.9.1, §11.9.2, E17; 02 §7.7. F18.
 *
 * `funding-reads.test.ts` covers what the readers do once they exist. This covers how they
 * come to exist, which is where the two legs stop being symmetric: deposit needs a second
 * light client and withdraw must never wait on one.
 *
 * The failure every test here is written against is the same one, in different clothes: an
 * Asset Hub outage presented to the user as *funding is down*. It is the natural shape of a
 * single `openFunding()` that connects both chains, and it is the shape §11.9.2 forbids by
 * saying the destination check *"degrades to a warning, never silently skipped"* while
 * §11.9.1 makes the Asset Hub connection a precondition **row**.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bleavit, assethub_paseo } from '@polkadot-api/descriptors';
import { fundingArtifacts, openDepositLeg, openWithdrawLeg } from '@bleavit/application';
import type { FundingArtifacts, FundingPins } from '@bleavit/application';
import { loadCodecs, loadMetadata } from '@bleavit/chain-client';
import { SameChainError, readDepositInputs, readWithdrawInputs } from '@bleavit/features-tx';
import type { FundingDecoders, FundingKeys, FundingReader } from '@bleavit/features-tx';
import type {
  AssetHubConnection,
  BundledChain,
  ChainHeadTransport,
  FinalizedBlockRef,
  StorageItem,
} from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString } from '@bleavit/shared-types';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

const LOCAL_CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const AH_CHAIN: HexString = `0x${'a5'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;

const AH_BUNDLE: BundledChain = {
  pinned: { id: 'asset-hub-paseo', kind: 'para', sha256: `0x${'cc'.repeat(32)}`, genesisHash: AH_CHAIN },
  chainSpec: '{}',
};

const PINS: FundingPins = { assetHub: AH_BUNDLE, usdcLocation: { parents: 1 } };

/** A transport labelled by the chain it follows, so a swap is visible in an assertion. */
interface FakeTransport extends ChainHeadTransport {
  readonly chain: HexString;
}

function transport(chain: HexString): FakeTransport {
  const at: FinalizedBlockRef = { chain, blockHash: BLOCK, blockNumber: 7 };
  return {
    chain,
    async pinnedBlock() {
      return at;
    },
    async storage(): Promise<readonly StorageItem[]> {
      return [];
    },
    async call() {
      return '0x';
    },
  };
}

/** `FinalizedReader.open`, in the shape the session injects it — one pin per transport. */
const openReader = async (t: FakeTransport): Promise<FundingReader> => {
  const at = await t.pinnedBlock();
  return {
    at,
    async storage(key: string) {
      return finalize([{ key, value: '0x' }], at);
    },
  };
};

const KEYS: FundingKeys = {
  assetHubUsdc: (assetId, who) => `ah:assets:${assetId}:${who}`,
  assetHubAccount: (who) => `ah:system:${who}`,
  phaseFlags: () => 'local:flags',
  localFreeUsdc: (who) => `local:usdc:${who}`,
};

const DECODERS: FundingDecoders = {
  assetHubUsdc: () => ({ ok: true, value: { balance: 0n } }),
  localFreeUsdc: () => ({ ok: true, value: { balance: 0n } }),
  systemAccount: () => ({ ok: true, value: { viable: true } }),
  phaseFlags: () => ({ ok: true, value: 0 }),
};

const ARTIFACTS: FundingArtifacts = { keys: KEYS, decoders: DECODERS };

const attached = (t: FakeTransport): AssetHubConnection<FakeTransport> => ({
  kind: 'attached',
  transport: t,
  genesisHash: AH_CHAIN,
});

/* ------------------------------------------------------------------ the deposit leg */

test('the deposit leg pairs one reader per chain, each on its own', async () => {
  const leg = await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader,
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async () => attached(transport(AH_CHAIN)),
  });
  assert.ok(leg.kind === 'ready', leg.kind === 'blocked' ? leg.reason : '');
  assert.equal(leg.readers.local.at.chain, LOCAL_CHAIN);
  assert.equal(leg.readers.assetHub.at.chain, AH_CHAIN);
  // The pair is branded, so what came back is one `fundingReaders` produced rather than a
  // literal assembled here — which is the check that cannot be skipped.
  const read = await readDepositInputs(leg.readers, KEYS, DECODERS, {
    who: '5Grw',
    assetId: 1337,
    amount: 1n,
    assetHubFee: 0n,
    minBalance: 0n,
    xcmHealthy: true,
    assetHubCompatible: true,
  });
  assert.equal(read.inputs.assetHubBalance?.status.kind, 'verified-finalized');
});

test('the bundle handed to the connector is the release pin, not something reconstructed', async () => {
  const seen: BundledChain[] = [];
  await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader,
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async (bundle) => {
      seen.push(bundle);
      return attached(transport(AH_CHAIN));
    },
  });
  assert.deepEqual(seen, [AH_BUNDLE]);
});

test('a refused Asset Hub leg blocks deposit with the connector’s OWN reason', async () => {
  // `attachAssetHub` and `assetHubConnector` already separate a wrong chain (terminal) from an
  // unreachable one (retryable, E17's recovery action is "retry AH sync"). Rewriting either
  // into a house sentence would discard the only thing a user acts on.
  for (const refusal of [
    { kind: 'wrong-chain', genesisHash: `0x${'ff'.repeat(32)}` as HexString, reason: 'retrying will not change this' },
    { kind: 'unavailable', reason: 'the Asset Hub chain has not synced' },
  ] as const) {
    const leg = await openDepositLeg({
      local: transport(LOCAL_CHAIN),
      openReader,
      artifacts: ARTIFACTS,
      pins: PINS,
      connectAssetHub: async () => refusal,
    });
    assert.ok(leg.kind === 'blocked');
    assert.equal(leg.reason, refusal.reason);
  }
});

test('a connector that THROWS still only blocks the deposit', async () => {
  // `assetHubConnector` never throws — every failure is an arm — so a throw means the connector
  // was replaced or the attach path itself failed. It must still not propagate: nothing about
  // the deposit leg is allowed to become a failure of the app (02 §7.7).
  const leg = await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader,
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async () => {
      throw new Error('the topology was already torn down');
    },
  });
  assert.ok(leg.kind === 'blocked');
  assert.match(leg.reason, /the topology was already torn down/);
  assert.match(leg.reason, /nothing else in the app is affected/);
});

test('Asset Hub is contacted BEFORE a local block is pinned', async () => {
  // A blocked deposit must cost no local read. The reverse order opens a reader whose pinned
  // block is then held for however long the Asset Hub sync takes, and a `FinalizedReader`'s
  // pin is only readable while the transport still holds that block.
  const order: string[] = [];
  await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader: async (t) => {
      order.push(`reader:${t.chain === LOCAL_CHAIN ? 'local' : 'assetHub'}`);
      return openReader(t);
    },
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async () => {
      order.push('connect');
      return attached(transport(AH_CHAIN));
    },
  });
  assert.deepEqual(order, ['connect', 'reader:assetHub', 'reader:local']);
});

test('an unreadable chain names WHICH chain could not be read', async () => {
  // Two different repairs. "Asset Hub has not synced" is E17's retry; "this chain could not be
  // read" is a local outage, and telling a user the wrong one sends them to the wrong place.
  const failing = async (t: FakeTransport): Promise<FundingReader> => {
    if (t.chain === AH_CHAIN) throw new Error('no finalized block on Asset Hub');
    return openReader(t);
  };
  const ah = await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader: failing,
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async () => attached(transport(AH_CHAIN)),
  });
  assert.ok(ah.kind === 'blocked');
  assert.match(ah.reason, /Asset Hub could not be read/);

  const local = await openDepositLeg({
    local: transport(LOCAL_CHAIN),
    openReader: async (t) => {
      if (t.chain === LOCAL_CHAIN) throw new Error('no finalized block here');
      return openReader(t);
    },
    artifacts: ARTIFACTS,
    pins: PINS,
    connectAssetHub: async () => attached(transport(AH_CHAIN)),
  });
  assert.ok(local.kind === 'blocked');
  assert.match(local.reason, /This chain could not be read/);
});

test('two readers on one chain THROW rather than blocking politely', async () => {
  // `attachAssetHub` already refuses a bundle pinning our own genesis, so reaching this needs
  // the LOCAL transport to be on Asset Hub — at which point every futarchy figure on every
  // screen is already a foreign read under a local label. A polite "deposits are unavailable"
  // would hide a release nothing else in the client can detect.
  await assert.rejects(
    () =>
      openDepositLeg({
        local: transport(AH_CHAIN),
        openReader,
        artifacts: ARTIFACTS,
        pins: PINS,
        connectAssetHub: async () => attached(transport(AH_CHAIN)),
      }),
    SameChainError,
  );
});

/* ----------------------------------------------------------------- the withdraw leg */

test('the withdraw leg has no Asset Hub connector to fail', async () => {
  // The structural half of §11.9.2, and the reason it is a separate function rather than a
  // flag: `WithdrawLegDeps` has no field a connector could occupy, so a later edit that wanted
  // to couple them would have to change this signature and meet the sentence on the way past.
  const leg = await openWithdrawLeg({ local: transport(LOCAL_CHAIN), openReader, artifacts: ARTIFACTS });
  assert.ok(leg.kind === 'ready');
  assert.equal(leg.reader.at.chain, LOCAL_CHAIN);
  const read = await readWithdrawInputs(leg.reader, KEYS, DECODERS, {
    who: '5Grw',
    amount: 1n,
    localFee: 0n,
    minBalance: 0n,
    ledgerFrozen: false,
    // §11.9.2's third state: the Asset Hub connection is unavailable, so the destination check
    // is a warning. The withdraw leg never asked for it and never waited on it.
    destinationViable: undefined,
  });
  assert.equal(read.inputs.destinationViable, undefined);
  assert.equal(read.inputs.freeBalance?.status.kind, 'verified-finalized');
});

test('withdraw is unaffected while every Asset Hub path is failing', async () => {
  // The whole point, stated as one test: the same inputs that block deposit leave withdraw
  // ready. A shared gate would take a lawful local `pallet_xcm` call offline because a chain it
  // does not need is down.
  const deps = { local: transport(LOCAL_CHAIN), openReader, artifacts: ARTIFACTS };
  const deposit = await openDepositLeg({
    ...deps,
    pins: PINS,
    connectAssetHub: async () => ({ kind: 'unavailable', reason: 'Asset Hub is down' }),
  });
  const withdraw = await openWithdrawLeg(deps);
  assert.equal(deposit.kind, 'blocked');
  assert.equal(withdraw.kind, 'ready');
});

test('a local outage blocks withdraw, and says it is not an Asset Hub problem', async () => {
  const leg = await openWithdrawLeg({
    local: transport(LOCAL_CHAIN),
    openReader: async () => {
      throw new Error('the pinned block is gone');
    },
    artifacts: ARTIFACTS,
  });
  assert.ok(leg.kind === 'blocked');
  assert.match(leg.reason, /the pinned block is gone/);
  assert.match(leg.reason, /not an Asset Hub problem/);
});

/* ------------------------------------------------------ the asymmetry, as source-level facts */

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('`WithdrawLegDeps` names no Asset Hub member at all', () => {
  // Asserted on the source because the property is an ABSENCE, and a runtime test can only
  // show that a field it did not pass was not used. A raw-text scan would match the module
  // header, which explains the rule at length — hence the comment strip.
  const source = withoutComments(
    readFileSync(join(APP, 'src/application/src/funding-session.ts'), 'utf8'),
  );
  const declaration = /export interface WithdrawLegDeps<[^>]*> \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(declaration, 'WithdrawLegDeps is no longer declared where this test can read it');
  const body = declaration[1] ?? '';
  assert.ok(body.length > 0, 'the interface body did not parse');
  assert.ok(
    !/assetHub|AssetHub/.test(body),
    `the withdraw leg gained an Asset Hub dependency:\n${body}`,
  );
  // And the deposit interface must still have one, or the assertion above passes vacuously
  // the day somebody moves the connector somewhere else entirely.
  const deposit = /export interface DepositLegDeps<[^>]*> extends WithdrawLegDeps<[^>]*> \{([\s\S]*?)\n\}/.exec(
    source,
  );
  assert.ok(deposit, 'DepositLegDeps no longer extends WithdrawLegDeps');
  assert.match(deposit[1] ?? '', /connectAssetHub/);
});

/* ------------------------------------------------------------------------- the artifacts */

test('the artifacts carry the injected USDC Location through to the key', async () => {
  // Release data, not a connection: both chains' metadata and descriptors are committed and
  // are present whether or not either chain is reachable, which is why this is the one thing
  // both legs share. What a wrapper like `fundingArtifacts` can silently drop is the
  // **Location**, and a `ForeignAssets.Account` key built without it addresses nothing — which
  // the chain answers with no value, and the withdraw screen renders as 0 USDC.
  //
  // The expectation is the runtime's own published key, read in place, and the Location is
  // decoded out of the runtime's own pre-image. Nothing here is written by hand.
  const runtimeFixture = JSON.parse(
    readFileSync(join(APP, '../runtime/bleavit-runtime/fixtures/storage-keys.json'), 'utf8'),
  ) as { readonly entries: readonly { name: string; preimages: readonly string[]; key: string }[] };
  const published = runtimeFixture.entries.find((e) => e.name === 'foreign_assets_account');
  assert.ok(published, 'the runtime fixture no longer publishes foreign_assets_account');

  const local = {
    codecs: await loadCodecs(bleavit),
    metadata: loadMetadata(readFileSync(join(APP, 'fixtures/chain-feed/2/metadata.scale'))),
  };
  const assetHub = {
    codecs: await loadCodecs(assethub_paseo),
    metadata: loadMetadata(
      readFileSync(join(APP, 'fixtures/foreign-chain-feed/asset-hub-paseo/2004002/metadata.scale')),
    ),
  };
  const inner = (
    (local.codecs as { query: Record<string, Record<string, unknown>> }).query['ForeignAssets']?.[
      'Account'
    ] as { args?: { inner?: unknown } } | undefined
  )?.args?.inner;
  assert.ok(Array.isArray(inner));
  const decode = (position: number): unknown =>
    (inner[position] as { dec(raw: string): unknown }).dec(published.preimages[position] ?? '0x');

  const artifacts = fundingArtifacts(
    { local, assetHub },
    { assetHub: AH_BUNDLE, usdcLocation: decode(0) },
  );
  assert.equal(
    artifacts.keys.localFreeUsdc(decode(1) as string).toLowerCase(),
    published.key.toLowerCase(),
  );
});
