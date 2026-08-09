/**
 * The drill harness's decisions, exercised without a chain — F27.
 *
 * `14-client-boot.zndsl` runs at the release tier, so nothing here is checked per commit by
 * the drill itself. What *is* checkable per commit is every decision the harness makes before
 * and after the light client call: which mode it accepts, what it does with a corrupted pin,
 * and — the one that matters — that a boot under `wrong-chain` is reported as a **failure**.
 *
 * That last one is the anti-vacuity property for the whole drill. If the harness treated a
 * successful boot under a corrupted pin as a pass, the third leg would be a green line that
 * witnesses nothing, which is this repository's most frequent defect wearing a drill's
 * clothes.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WrongChainError, chainSpecHash, relayChainOf, verifyBundledChainSpec } from '@bleavit/chain-client';
import { foreignIdentityVerdict } from '@bleavit/application';

import { assetHubLabel } from '../../tools/drill-client/foreign-label.ts';
import {
  DrillBootError,
  assetHubVerdictOf,
  corruptGenesis,
  main,
  type DrillReport,
} from '../../tools/drill-client/boot.ts';

const GENESIS = '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3';

function pinDocument(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-drill-boot-'));
  const path = join(dir, 'dev-pin.json');
  writeFileSync(
    path,
    JSON.stringify({
      schema: 'bleavit.dev-chain-pin.v1',
      relay: {
        pinned: { id: 'paseo-local', kind: 'relay', sha256: GENESIS, genesisHash: GENESIS },
        chainSpec: '{}',
      },
      para: {
        pinned: {
          id: 'bleavit_local_drills',
          kind: 'para',
          sha256: GENESIS,
          genesisHash: GENESIS,
          relayChainId: 'paseo-local',
        },
        chainSpec: '{}',
      },
      ...overrides,
    }),
  );
  return path;
}

test('the corrupted genesis is still a well-formed hash', () => {
  const corrupted = corruptGenesis(GENESIS);
  assert.notEqual(corrupted, GENESIS);
  assert.equal(corrupted.length, GENESIS.length);
  // The point of mutating rather than substituting a constant. `chain-session.ts` refuses a
  // pin whose hash is the wrong SHAPE before a worker is ever spawned, and that is a
  // different control — a malformed value would never reach `assertGenesisIdentity`, so the
  // leg would pass while leaving FE-BOOT-003 unwitnessed.
  assert.match(corrupted, /^0x[0-9a-f]{64}$/i);
});

test('only the last nibble moves, and it always moves', () => {
  // Named for what it checks. It is NOT an involution — '3' flips to '0', which flips to '1'
  // — and an earlier name claimed reversibility while asserting a prefix against itself.
  for (const tail of ['0', '1', '3', 'f']) {
    const hash = `${GENESIS.slice(0, -1)}${tail}`;
    const flipped = corruptGenesis(hash);
    assert.equal(flipped.slice(0, -1), hash.slice(0, -1), 'a byte other than the last moved');
    assert.notEqual(flipped, hash, `${tail} was left unchanged`);
  }
});

test('an unknown mode is refused rather than defaulting to boot', async () => {
  await assert.rejects(
    () => main(['--pin', pinDocument(), '--mode', 'probe']),
    (error: unknown) => error instanceof DrillBootError && /unknown --mode/.test(error.message),
  );
});

test('a pin document of the wrong schema is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-drill-boot-'));
  const path = join(dir, 'dev-pin.json');
  writeFileSync(path, JSON.stringify({ schema: 'bleavit.release-pin.v1' }));
  await assert.rejects(
    () => main(['--pin', path]),
    (error: unknown) => error instanceof DrillBootError && /unexpected pin schema/.test(error.message),
  );
});

test('a missing --pin is named, not read as an empty path', async () => {
  await assert.rejects(
    () => main([]),
    (error: unknown) => error instanceof DrillBootError && /--pin is required/.test(error.message),
  );
});

test('a non-positive --timeout-seconds is refused', async () => {
  for (const value of ['0', '-5', 'soon']) {
    await assert.rejects(
      () => main(['--pin', pinDocument(), '--timeout-seconds', value]),
      (error: unknown) =>
        error instanceof DrillBootError && /--timeout-seconds must be a positive number/.test(error.message),
      `--timeout-seconds ${value} was accepted`,
    );
  }
});

test('the wrong-chain leg fails when the client boots anyway', async () => {
  // The anti-vacuity property of the whole drill, asserted directly. With the boot stubbed
  // to SUCCEED, `--mode wrong-chain` must still report a failure — a harness that passed
  // here would turn the drill's third leg into a green line witnessing nothing, which is
  // this repository's most frequent defect wearing a drill's clothes.
  //
  // A real client cannot be asked to produce this case, which is exactly why the call is
  // injected rather than reached through the module.
  const booted: DrillReport = {
    mode: 'boot',
    chain: 'bleavit_local_drills',
    genesisHash: GENESIS,
    specVersion: 2,
    compat: 'classified',
    compatMode: 'full',
    // Both undefined because this pin document carries no Asset Hub role, which is what the
    // producer writes for one. The report never reaches `assertBootReport` here — the leg under
    // test refuses it for having booted at all.
    assetHub: undefined,
    assetHubVerdict: undefined,
    finalizedHash: GENESIS,
  };
  await assert.rejects(
    () => main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async () => booted),
    (error: unknown) =>
      error instanceof DrillBootError && /booted against a corrupted/.test(error.message),
  );
});

test('a refusal that is not the identity check does not count', async () => {
  // The other way the leg goes vacuous: something else refuses first — a malformed spec, an
  // unreachable peer — and the harness reads any rejection as proof of FE-BOOT-003.
  await assert.rejects(
    () =>
      main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async () => {
        throw new Error('no peers');
      }),
    (error: unknown) =>
      error instanceof DrillBootError && /not by the identity check/.test(error.message),
  );
});

test('the identity refusal is accepted, and it carries both hashes', async () => {
  const expected = GENESIS;
  const observed = corruptGenesis(GENESIS);
  const report = JSON.parse(
    await main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async () => {
      throw new WrongChainError(observed as `0x${string}`, expected as `0x${string}`);
    }),
  ) as { refused: boolean; code: string; expected: string; observed: string };
  assert.equal(report.refused, true);
  assert.equal(report.code, 'FE-BOOT-003');
  // The drill helper refuses a refusal whose two hashes are equal, because that is what a
  // pin compared with itself looks like. Both must survive into the report for it to check.
  assert.notEqual(report.expected, report.observed);
});

test('the boot leg passes the corrupted pin, never the original', async () => {
  let seen: string | undefined;
  // `main` RESOLVES on a WrongChainError whose expectation matches the corrupted pin, so an
  // `assert.rejects` here would always fail — and an earlier version hid that with a trailing
  // `.catch(() => undefined)`, which made the expectation inert. Awaited plainly instead.
  await main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async (document) => {
    seen = document.para.pinned.genesisHash;
    throw new WrongChainError(seen as `0x${string}`, corruptGenesis(GENESIS) as `0x${string}`);
  });
  assert.notEqual(seen, GENESIS, 'the wrong-chain leg booted the uncorrupted pin');
  assert.equal(seen, corruptGenesis(GENESIS));
});

/**
 * The spelling that no fixture in this package used — F27.
 *
 * Every chain spec this repository produces carries `relay_chain`, because a parachain's relay
 * and para id come from Cumulus's `Extensions` struct, which Substrate does not rename to
 * camelCase. This reader accepted only `relayChain`, so it would have refused every genuine
 * parachain spec — drill and production alike — and nothing noticed, because each fixture here
 * was written by hand in the spelling the reader already required.
 *
 * These cases are therefore keyed on the artifact's spelling rather than on a fixture's, which
 * is the only version of this test that could have failed before the fix.
 */
test('a parachain spec spelled the way chain-spec-builder spells it is accepted', async () => {
  const spec = {
    id: 'bleavit_local_drills',
    name: 'Bleavit Local Drills',
    relay_chain: 'paseo-local',
    para_id: 4242,
    bootNodes: [],
    genesis: { raw: { top: {} } },
  };
  const text = JSON.stringify(spec);
  const parsed = await verifyBundledChainSpec(text, {
    id: 'bleavit_local_drills',
    kind: 'para',
    sha256: await chainSpecHash(text),
    genesisHash: GENESIS as `0x${string}`,
    relayChainId: 'paseo-local',
  });
  assert.equal(parsed.relayChain, 'paseo-local');
});

test('a spec carrying both spellings that disagree is refused, never resolved', () => {
  assert.throws(
    () => relayChainOf({ relayChain: 'paseo-local', relay_chain: 'polkadot' }),
    /declares two different relay chains/,
  );
  // Agreeing duplicates are not an edit and are read as the one fact they state.
  assert.equal(relayChainOf({ relayChain: 'paseo-local', relay_chain: 'paseo-local' }), 'paseo-local');
});

test('a relay spec is still refused for declaring a relay, under either spelling', async () => {
  for (const key of ['relayChain', 'relay_chain']) {
    const text = JSON.stringify({ id: 'paseo-local', [key]: 'polkadot', genesis: { raw: { top: {} } } });
    const sha256 = await chainSpecHash(text);
    await assert.rejects(
      () =>
        verifyBundledChainSpec(text, {
          id: 'paseo-local',
          kind: 'relay',
          sha256,
          genesisHash: GENESIS as `0x${string}`,
        }),
      /declares a relayChain/,
      `a relay spec declaring ${key} was accepted`,
    );
  }
});

test('a refusal about a chain this leg did not corrupt is rejected', async () => {
  // The blocker the R-6 review found. `startTopology` asserts the RELAY identity first, so a
  // stale relay pin raises `WrongChainError` too — and a leg that accepted any of them would
  // report FE-BOOT-003 witnessed while the corrupted parachain pin was never reached. That is
  // a check that cannot fail, which is the exact defect class this milestone exists to find.
  const someOtherChain = '0x1111111111111111111111111111111111111111111111111111111111111111';
  await assert.rejects(
    () =>
      main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async () => {
        throw new WrongChainError(someOtherChain as `0x${string}`, GENESIS as `0x${string}`);
      }),
    (error: unknown) =>
      error instanceof DrillBootError && /did not corrupt/.test(error.message),
  );
});

/* ------------------------------- the Asset Hub verdict, and the harness rule it feeds (F18) */

/**
 * The rule the drill applies, loaded the way the drill loads it.
 *
 * The same binding `drill-client-funding.test.ts` makes for the funding leg, for the same
 * reason: a rule keyed on `assetHubVerdict.mode` beside a producer writing `assetHubMode` leaves
 * both suites green while the drill checks nothing. `bootAndClassify` itself needs a light
 * client and three chains, so what is bound here is the decision it delegates.
 */
const harnessRules = createRequire(import.meta.url)(
  join(dirname(fileURLToPath(import.meta.url)), '../..', '..', 'zombienet', 'drills', 'js', 'client-boot-rules.js'),
) as { assertBootReport(report: unknown): unknown };

const CLASSIFIED: DrillReport = {
  mode: 'boot',
  chain: 'bleavit_local_drills',
  genesisHash: GENESIS,
  specVersion: 2,
  compat: 'classified',
  compatMode: 'full',
  assetHub: undefined,
  assetHubVerdict: { kind: 'unestablished' },
  finalizedHash: corruptGenesis(GENESIS),
};

test('the Asset Hub verdict reaches the report as a value, not as a sentence', () => {
  // It used to be written as `classified: wrong-chain` — one string, and a harness rule about it
  // could only match prose. This branch already removed that pattern once from the funding leg,
  // where a blocked deposit reported five different causes as one nonempty sentence.
  const local = '0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
  assert.deepEqual(assetHubVerdictOf(foreignIdentityVerdict(assetHubLabel(), local)), {
    kind: 'classified',
    mode: 'wrong-chain',
  });
});

test('the development-label verdict is refused by the boot rule, through the real mapping', () => {
  // Real classifier, real pin list, real mapping, real harness rule — the chain of custody the
  // funding leg already has. `asset-hub-paseo-local` is the connected spec's id, which matches no
  // pin, so `classifyForeign` answers `unreachable`: retryable, where a locally generated Asset
  // Hub is terminally the wrong chain.
  const local = '0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
  const bugged = assetHubVerdictOf(foreignIdentityVerdict('asset-hub-paseo-local', local));
  assert.deepEqual(bugged, { kind: 'classified', mode: 'unreachable' });
  assert.throws(
    () => harnessRules.assertBootReport({ ...CLASSIFIED, assetHubVerdict: bugged }),
    /can only ever reach "wrong-chain"/,
  );

  // The negative control, through the same mapping.
  const pinned = assetHubVerdictOf(foreignIdentityVerdict(assetHubLabel(), local));
  harnessRules.assertBootReport({ ...CLASSIFIED, assetHubVerdict: pinned });
});

test('an Asset Hub that never answered still classifies, and the rule accepts it', () => {
  // `unestablished` is what a metadata pull that failed or timed out produces. The boot leg is
  // allowed to report it: 15 §4.8 constrains the verdict a *classified* Asset Hub can carry, and
  // says nothing about one this run never established.
  assert.deepEqual(assetHubVerdictOf({ kind: 'unestablished', reason: 'no metadata' }), {
    kind: 'unestablished',
  });
  harnessRules.assertBootReport(CLASSIFIED);
});
