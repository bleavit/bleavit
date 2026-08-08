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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WrongChainError, chainSpecHash, relayChainOf, verifyBundledChainSpec } from '@bleavit/chain-client';

import {
  DrillBootError,
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

test('flipping is reversible, so exactly one nibble moved', () => {
  assert.equal(corruptGenesis(corruptGenesis(GENESIS)).slice(0, -1), GENESIS.slice(0, -1));
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
    compat: 'full',
    assetHub: undefined,
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
  await assert.rejects(() =>
    main(['--pin', pinDocument(), '--mode', 'wrong-chain'], async (document) => {
      seen = document.para.pinned.genesisHash;
      throw new WrongChainError(GENESIS as `0x${string}`, seen as `0x${string}`);
    }),
  ).catch(() => undefined);
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
