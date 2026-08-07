/**
 * The development chain pin — F18, ruled 2026-08-07.
 *
 * > A development pin may exist. It may never live in `release-sources.json`.
 *
 * Two properties carry this suite, and neither is the happy path.
 *
 * **The output is fed to the real consumer.** `verifyBundledChainSpec` is what the boot path
 * runs against a pin before `addChain` sees a byte, so the last test hands it exactly what
 * this tool produced. A producer checked against a list of what the consumer was *believed* to
 * check is a producer that ships a document failing at the drill — the same discipline
 * `tools/snapshot` follows when it runs the client's own `admitSnapshot` over its output.
 *
 * **The refusal to write into a release path is tested as a refusal.** It is the entire
 * mechanical content of the ruling: a development pin cannot reach a release because it is
 * never in a field a release reads, and this is what keeps that true when somebody points
 * `--out` at the obvious place.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

import { verifyBundledChainSpec } from '@bleavit/chain-client';
import type { PinnedChainSpec } from '@bleavit/chain-client';
import { DevPinError, buildDevPin, main, refuseReleasePath, sha256Hex } from '../../tools/dev-chain-pin.ts';

const genesis = (byte: string): string => `0x${byte.repeat(32)}`;

const spec = (overrides: Record<string, unknown>): string =>
  JSON.stringify({ name: 'Fixture', genesis: { raw: { top: {} } }, ...overrides });

const RELAY = spec({ id: 'paseo_local' });
const PARA = spec({ id: 'bleavit_dev', relayChain: 'paseo_local' });
const ASSET_HUB = spec({ id: 'asset_hub_local', relayChain: 'paseo_local' });

const inputs = (overrides: Record<string, unknown> = {}) => ({
  relay: { chainSpec: RELAY, genesisHash: genesis('a1') },
  para: { chainSpec: PARA, genesisHash: genesis('b2') },
  ...overrides,
});

/* ---------------------------------------------------------------- it is not a release pin */

test('a development pin refuses to be written anywhere a release reads', () => {
  // The ruling, mechanically. Each of these paths is one where "a development pin exists"
  // silently becomes "a release is pinned to a development chain".
  for (const target of [
    'app/tools/release/sources/release-sources.json',
    'app/dist/chain-specs/dev.json',
    'app/release-out/dev-pin.json',
    'app/fixtures/chain-feed/2/dev.json',
  ]) {
    assert.throws(() => refuseReleasePath(target), DevPinError, target);
  }
});

test('the path is RESOLVED first, so the ordinary relative spelling is caught too', () => {
  // The fixtures above all contain their forbidden fragment literally, so a check on the raw
  // argument string passes every one of them — measured: the mutation that deletes `resolve`
  // survived the whole suite until this test existed. The dodge is not exotic. It is what
  // anybody types: `--out dev-pin.json` from inside the directory, or a path relative to the
  // repository root. Neither contains a leading-slash fragment and both land in the file a
  // release reads.
  const cwd = process.cwd();
  try {
    process.chdir(join(APP, 'tools', 'release', 'sources'));
    assert.throws(() => refuseReleasePath('dev-pin.json'), DevPinError, 'a bare filename inside the release sources');
    process.chdir(APP);
    assert.throws(() => refuseReleasePath('dist/chain-specs/dev.json'), DevPinError, 'a cwd-relative dist path');
    assert.throws(() => refuseReleasePath('tools/release/sources/dev.json'), DevPinError, 'a cwd-relative sources path');
  } finally {
    process.chdir(cwd);
  }
});

test('a scratch path is allowed, so the refusal is not a refusal of everything', () => {
  // Anti-vacuity: a `refuseReleasePath` that threw on every input would satisfy the test above
  // perfectly and make the tool unusable, which is how a control gets deleted rather than fixed.
  refuseReleasePath(join(tmpdir(), 'drill', 'dev-pin.json'));
});

test('the emitted document says what it is not', () => {
  // A file that travels to a machine running a drill needs its own warning, because the person
  // who finds it later did not read this suite.
  return buildDevPin(inputs()).then((document) => {
    assert.equal(document.schema, 'bleavit.dev-chain-pin.v1');
    assert.match(document.note, /never be copied into/);
    assert.match(document.note, /release-sources\.json/);
  });
});

/* ------------------------------------------------------------- the genesis hash is supplied */

test('a genesis hash that is not one is refused, with the reason it cannot be computed', async () => {
  // R-2 in a tool. The genesis hash is the blake2-256 of the genesis *header*, whose state root
  // is the trie root of the genesis storage — no function of the file's bytes produces it, so
  // inventing one here would be resolving an identity by assumption.
  for (const bad of ['', 'null', '0xdeadbeef', 'the one the node printed']) {
    await assert.rejects(
      () => buildDevPin(inputs({ para: { chainSpec: PARA, genesisHash: bad } })),
      (error: unknown) => {
        assert.ok(error instanceof DevPinError, String(error));
        assert.match(error.message, /property of the genesis storage trie/);
        return true;
      },
    );
  }
});

/* -------------------------------------------------------------- the refusals a drill needs */

test('a non-raw spec is refused here rather than as a chain that never finalises', async () => {
  await assert.rejects(
    () => buildDevPin(inputs({ relay: { chainSpec: JSON.stringify({ id: 'x', genesis: { runtimeGenesis: {} } }), genesisHash: genesis('a1') } })),
    /not a raw spec/,
  );
});

test('a relay spec declaring a relayChain is refused, and a para spec without one too', async () => {
  await assert.rejects(
    () => buildDevPin(inputs({ relay: { chainSpec: PARA, genesisHash: genesis('a1') } })),
    /would be treated as a parachain/,
  );
  await assert.rejects(
    () => buildDevPin(inputs({ para: { chainSpec: RELAY, genesisHash: genesis('b2') } })),
    /declares no relayChain/,
  );
});

test('a parachain naming a different relay is refused', async () => {
  await assert.rejects(
    () =>
      buildDevPin(
        inputs({ para: { chainSpec: spec({ id: 'bleavit_dev', relayChain: 'westend' }), genesisHash: genesis('b2') } }),
      ),
    /the linkage would never form/,
  );
});

test('two roles pinning one genesis are refused — they are not two chains', async () => {
  // `attachAssetHub`'s refusal at the producer. An Asset Hub bundle pinning our own genesis
  // passes every other check and renders futarchy balances under an Asset Hub label.
  await assert.rejects(
    () =>
      buildDevPin(
        inputs({
          assetHub: { chainSpec: ASSET_HUB, genesisHash: genesis('b2') },
        }),
      ),
    /not two chains at all/,
  );
  // …and the relay counts too, which a check written only over the two parachains would miss.
  await assert.rejects(
    () => buildDevPin(inputs({ para: { chainSpec: PARA, genesisHash: genesis('a1') } })),
    /not two chains at all/,
  );
});

/* --------------------------------------------------- the pin is one the boot path accepts */

test('the pin this tool emits is one `verifyBundledChainSpec` accepts', async () => {
  // The producer↔consumer binding. A pin checked only against what the consumer was believed
  // to check is one that fails at the drill, for reasons the drill cannot explain.
  const document = await buildDevPin(inputs({ assetHub: { chainSpec: ASSET_HUB, genesisHash: genesis('c3') } }));
  for (const role of [document.relay, document.para, document.assetHub]) {
    assert.ok(role !== undefined);
    const parsed = await verifyBundledChainSpec(role.chainSpec, role.pinned as PinnedChainSpec);
    assert.equal(parsed.id, role.pinned.id);
  }
});

test('the hash is of the exact bytes, so the pin cannot drift from the file', async () => {
  const document = await buildDevPin(inputs());
  assert.equal(document.relay.pinned.sha256, await sha256Hex(RELAY));
  // One byte of whitespace is a different file, and `verifyBundledChainSpec` compares bytes.
  await assert.rejects(
    () => verifyBundledChainSpec(`${RELAY} `, document.relay.pinned as PinnedChainSpec),
    /does not match its release pin/,
  );
});

test('a spec with a trailing newline is pinned INCLUDING it', async () => {
  // The mutation this was written from survived the test above: normalising the bytes before
  // hashing — `.trim()` — is invisible while every fixture is a `JSON.stringify` result with
  // nothing to trim. Real spec files are not: `chain-spec-builder` writes a trailing newline,
  // so a producer that normalised would emit a pin the boot path rejects for the whole drill,
  // reporting it as a substituted chain spec.
  const withNewline = `${RELAY}\n`;
  const document = await buildDevPin({
    relay: { chainSpec: withNewline, genesisHash: genesis('a1') },
    para: { chainSpec: PARA, genesisHash: genesis('b2') },
  });
  assert.equal(document.relay.pinned.sha256, await sha256Hex(withNewline));
  assert.notEqual(document.relay.pinned.sha256, await sha256Hex(RELAY));
  const parsed = await verifyBundledChainSpec(withNewline, document.relay.pinned as PinnedChainSpec);
  assert.equal(parsed.id, 'paseo_local');
});

/* ------------------------------------------------------------------------------ the CLI */

test('the CLI reads the specs off disk and writes a document a harness can inject', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-dev-pin-'));
  const relayPath = join(dir, 'relay.json');
  const paraPath = join(dir, 'para.json');
  const outPath = join(dir, 'dev-pin.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(relayPath, RELAY);
  writeFileSync(paraPath, PARA);

  await main([
    '--relay', relayPath, '--relay-genesis', genesis('a1'),
    '--para', paraPath, '--para-genesis', genesis('b2'),
    '--out', outPath,
  ]);
  const written = JSON.parse(readFileSync(outPath, 'utf8')) as { para: { pinned: { id: string } } };
  assert.equal(written.para.pinned.id, 'bleavit_dev');
});

test('a missing argument is named rather than producing a pin over `undefined`', async () => {
  await assert.rejects(() => main(['--relay', '/nowhere']), /--relay-genesis is required/);
});
