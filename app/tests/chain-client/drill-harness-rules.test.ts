/**
 * The drill harness's decisions, per commit — F18.
 *
 * `zombienet/drills/js/client-boot.js` runs at the release tier, so nothing in it is exercised
 * per commit by the drill itself. It has shipped **two live-only defects**, and both were
 * decisions rather than plumbing:
 *
 *  1. it spawned the bare name `node`, which pkg re-points at zombienet's embedded Node
 *     **18.5.0** — reported as a `SyntaxError` on a correct `import` in a correct file;
 *  2. it parsed a leg's whole stdout as JSON, which smoldot's worker-thread log callback also
 *     writes to — reported as `Unexpected token s in JSON at position 1` after a 348-second run
 *     that had succeeded.
 *
 * Neither could have been caught earlier, because every function that made a decision also
 * performed the I/O around it. `client-boot-rules.js` is the seam: pure functions over values,
 * required by the harness and by this suite.
 *
 * ## Why `createRequire` rather than an import
 *
 * The rules module is **CommonJS outside the `app` workspace**, because it is loaded by a
 * helper the pinned zombienet binary runs under its own Node. Loading it at runtime keeps that
 * true: this suite exercises the file the drill actually requires, with no build step, no
 * `tsconfig` include reaching outside `app/`, and no dependency-cruiser edge out of the
 * workspace. A copy under `app/` that this suite imported instead would be a second file, and
 * the one that runs in the drill would go on being untested.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface HarnessRules {
  admissibleNode(pinned: string, version: string, packaged: string): boolean;
  networkDir(networkInfo: unknown, env: Record<string, string | undefined>): string;
  looksLikeGenesisHeader(headerHex: unknown): boolean;
  missingReportError(label: string, file: string, stdout: string): Error;
  assertBootReport(report: unknown): unknown;
  assertWrongChainReport(report: unknown): unknown;
  assertFundingReport(report: unknown): unknown;
}

const load = createRequire(import.meta.url);
const rules: HarnessRules = load(join(APP, '..', 'zombienet', 'drills', 'js', 'client-boot-rules.js'));

/* ------------------------------------------------------- defect 1: zombienet's embedded Node */

test('the pkg Node is rejected on `process.pkg`, not on its version', () => {
  // The whole point of testing `process.pkg` as well as the version: the day zombienet is
  // repackaged on a Node in the admissible major, a version-only rule starts accepting it and
  // the drill silently runs the client under an interpreter that reads ESM as CommonJS.
  assert.equal(rules.admissibleNode('22.18.0', 'v22.18.0', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.18.0', 'v22.18.0', 'object'), false, 'a pkg binary in the pinned version was accepted');
  assert.equal(rules.admissibleNode('22.18.0', 'v18.5.0', 'object'), false);
});

test('the band is closed at both ends, because `engines.node` is', () => {
  // `app/package.json` pins ">=22.18.0 <23" — one band, deliberately closed. "At least the
  // floor" would admit Node 23, which is not a Node CI installs.
  assert.equal(rules.admissibleNode('22.18.0', 'v22.18.1', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.18.0', 'v22.19.0', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.18.0', 'v23.0.0', 'undefined'), false, 'the next major was admitted');
  assert.equal(rules.admissibleNode('22.18.0', 'v22.17.9', 'undefined'), false, 'below the floor was admitted');
  assert.equal(rules.admissibleNode('22.18.0', 'v18.5.0', 'undefined'), false, 'Node 18 was admitted');
});

test('a version that is not one is rejected rather than parsed into something', () => {
  for (const version of ['', 'v22', 'v22.18', 'twenty-two', 'v22.x.0']) {
    assert.equal(rules.admissibleNode('22.18.0', version, 'undefined'), false, `accepted ${JSON.stringify(version)}`);
  }
  // …and a pin this suite cannot read is loud, because it decides every answer above.
  assert.throws(() => rules.admissibleNode('22.18', 'v22.18.0', 'undefined'), /does not hold an x\.y\.z version/);
});

/* -------------------------------------------------------- defect 2: the report is not stdout */

test('a leg that exits 0 with no report is a failure that names the file and shows stdout', () => {
  // The alternative — reading whatever the file held from the previous run — is the mistake
  // this drill exists to not make: its whole subject is a check that stopped checking.
  const error = rules.missingReportError('client boot', '/tmp/report.json', 'smoldot log line');
  assert.match(error.message, /wrote no report to \/tmp\/report\.json/);
  assert.match(error.message, /smoldot log line/);
});

/* ------------------------------------------------------ the spawned specs, not the generated */

test('the network directory comes from the spawned network, under any of its three spellings', () => {
  assert.equal(rules.networkDir({ networkSpecPath: '/run/zombie-1/zombie.json' }, {}), '/run/zombie-1');
  assert.equal(rules.networkDir({ tmpDir: '/run/zombie-2' }, {}), '/run/zombie-2');
  assert.equal(rules.networkDir(undefined, { ZOMBIE_DIR: '/run/zombie-3' }), '/run/zombie-3');
});

test('a harness that cannot locate the spawned network fails rather than using the generated specs', () => {
  // Zombienet rewrites the specs it is given before booting them, so the generated file and
  // the running chain have different genesis hashes. Falling back to `zombienet/specs/out/`
  // would pin one chain while reading the genesis off another.
  assert.throws(() => rules.networkDir({}, {}), /a DIFFERENT chain/);
});

/* ------------------------------------------------------------------- the genesis header shape */

test('only a genesis header is accepted — zero parent, block 0, long enough', () => {
  const root = `${'ee'.repeat(32)}`;
  assert.equal(rules.looksLikeGenesisHeader(`0x${'00'.repeat(32)}00${root}${'03'.repeat(32)}00`), true);
  assert.equal(rules.looksLikeGenesisHeader(`0x${'ab'.repeat(32)}00${root}${'03'.repeat(32)}00`), false, 'a non-zero parent');
  assert.equal(rules.looksLikeGenesisHeader(`0x${'00'.repeat(32)}04${root}${'03'.repeat(32)}00`), false, 'block 1');
  assert.equal(rules.looksLikeGenesisHeader(`0x${'00'.repeat(40)}`), false, 'too short');
  for (const bad of ['', 'deadbeef', undefined, 42]) {
    assert.equal(rules.looksLikeGenesisHeader(bad), false, `accepted ${String(bad)}`);
  }
});

/* ------------------------------------------------------------------- the boot leg's acceptance */

const BOOT = { compat: 'classified', compatMode: 'full', finalizedHash: `0x${'11'.repeat(32)}` };

test('the boot leg asserts the 10 §5.2 MODE, not the verdict wrapper', () => {
  rules.assertBootReport(BOOT);
  // `read-only-incompatible` is `classified`, so a leg checking only the wrapper would pass on
  // exactly the regression it exists to catch.
  for (const mode of ['restricted', 'read-only-incompatible', undefined]) {
    assert.throws(() => rules.assertBootReport({ ...BOOT, compatMode: mode }), /not "full"/, `mode ${String(mode)}`);
  }
});

test('a classifier that ran without a chain is a boot that did not happen', () => {
  assert.throws(() => rules.assertBootReport({ ...BOOT, compat: 'unestablished' }), /ran without a chain/);
});

test('a boot with no finalized head is refused, however it is classified', () => {
  for (const hash of [undefined, '', 'not-a-hash', 42]) {
    assert.throws(() => rules.assertBootReport({ ...BOOT, finalizedHash: hash }), /no finalized head/);
  }
});

/* ------------------------------------------------------- the wrong-chain leg's anti-vacuity */

const REFUSED = {
  refused: true,
  code: 'FE-BOOT-003',
  role: 'para',
  expected: `0x${'aa'.repeat(32)}`,
  observed: `0x${'bb'.repeat(32)}`,
  uncorrupted: `0x${'bb'.repeat(32)}`,
};

test('the wrong-chain leg accepts only a refusal about the pin it corrupted', () => {
  rules.assertWrongChainReport(REFUSED);
  assert.throws(() => rules.assertWrongChainReport({ ...REFUSED, refused: false }), /not refused as FE-BOOT-003/);
  assert.throws(() => rules.assertWrongChainReport({ ...REFUSED, code: 'FE-BOOT-001' }), /not refused as FE-BOOT-003/);
  // A refusal comparing a value with itself never reached the identity check.
  assert.throws(
    () => rules.assertWrongChainReport({ ...REFUSED, observed: REFUSED.expected, uncorrupted: REFUSED.expected }),
    /compared a value with itself/,
  );
  // `startTopology` asserts the RELAY first, so a stale relay pin raises FE-BOOT-003 too — and
  // accepting it would report the control witnessed while the flipped byte was never reached.
  assert.throws(() => rules.assertWrongChainReport({ ...REFUSED, role: 'relay' }), /not about the corrupted parachain pin/);
  assert.throws(
    () => rules.assertWrongChainReport({ ...REFUSED, uncorrupted: `0x${'cc'.repeat(32)}` }),
    /not about the corrupted parachain pin/,
  );
});

/* ------------------------------------------------------------------ the funding leg (F18) */

const READ = { surface: 'ForeignAssets.Account', key: `0x${'de'.repeat(20)}`, decoded: '0' };
const FUNDING = {
  mode: 'funding',
  publishedKeyAgrees: true,
  driverInputs: { amount: '1000000' },
  withdraw: { kind: 'ready', chain: `0x${'ce'.repeat(32)}`, blockNumber: 7, reads: [READ], undecodable: [], blocks: [] },
  deposit: {
    kind: 'ready',
    localChain: `0x${'ce'.repeat(32)}`,
    assetHubChain: `0x${'a5'.repeat(32)}`,
    localBlockNumber: 7,
    assetHubBlockNumber: 9,
    foreignMode: 'wrong-chain',
    reads: [READ, READ],
    undecodable: [],
    blocks: ['Asset Hub connection: …'],
  },
};

test('a BLOCKED deposit passes, because 02 §7.7 requires exactly that', () => {
  // The leg must not demand a green deposit. §7.7 requires an unavailable or unpinned Asset Hub
  // to block the flow *with diagnostics*, so a rule insisting on `ready` would fail on the
  // correct behaviour and could only be satisfied by pointing the drill at the real Asset Hub.
  rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'blocked', reason: 'Asset Hub is not attached.' } });
  // …but a blocked leg carrying no diagnostics is not "blocked with diagnostics" (11 E17).
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'blocked', reason: '' } }),
    /neither ready nor blocked-with-diagnostics/,
  );
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'exploded' } }),
    /neither ready nor blocked-with-diagnostics/,
  );
});

test('a BLOCKED withdraw fails, because §11.9.2 says it does not depend on Asset Hub', () => {
  // The asymmetry is the property worth proving live: a blocked withdraw beside a blocked
  // deposit is the "funding is down" coupling 02 §7.7 and §11.9.2 exist to forbid.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { kind: 'blocked', reason: 'Asset Hub is down.' } }),
    /independent of Asset Hub/,
  );
});

test('a leg that reported ready without reading anything is the one outcome refused outright', () => {
  for (const reads of [[], undefined, 'two']) {
    assert.throws(
      () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads } }),
      /reported ready with no reads at all/,
      `accepted reads=${JSON.stringify(reads)}`,
    );
  }
  // A "read" with no storage key is the same claim wearing an array.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads: [{ surface: 'x' }] } }),
    /a read with no storage key/,
  );
});

test('a key that is not the runtime\'s own published key fails the whole leg', () => {
  // Every read below it asked the chain about the wrong entry, and an empty answer to the
  // wrong key is indistinguishable from an honest zero balance.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, publishedKeyAgrees: false }),
    /not the key the runtime published/,
  );
});

test('two deposit readers on one chain are refused — that is `SameChainError`\'s subject', () => {
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { ...FUNDING.deposit, assetHubChain: FUNDING.deposit.localChain } }),
    /under an Asset Hub label/,
  );
});

test('a ready deposit with no 02 §7.7 verdict is refused', () => {
  // The verdict is §11.9.1's first precondition row. A leg reporting `ready` without one is
  // reporting that a deposit may be constructed against a chain nothing classified.
  for (const foreignMode of [undefined, '', 42]) {
    assert.throws(
      () => rules.assertFundingReport({ ...FUNDING, deposit: { ...FUNDING.deposit, foreignMode } }),
      /carries no 02 §7.7 foreign verdict/,
      `accepted ${String(foreignMode)}`,
    );
  }
});

test('the happy shape passes, so none of the refusals above is refusing everything', () => {
  assert.equal(rules.assertFundingReport(FUNDING), FUNDING);
});
