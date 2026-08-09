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

import { FUNDING_READS } from '@bleavit/features-tx';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface HarnessRules {
  admissibleNode(pinned: string, version: string, packaged: string): boolean;
  networkDir(networkInfo: unknown, env: Record<string, string | undefined>): string;
  looksLikeGenesisHeader(headerHex: unknown): boolean;
  missingReportError(label: string, file: string, stdout: string): Error;
  assertBootReport(report: unknown): unknown;
  assertWrongChainReport(report: unknown): unknown;
  assertFundingReport(report: unknown): unknown;
  /** Exported so this suite can bind the harness's restatement to the frozen `FUNDING_READS`. */
  readonly REQUIRED_SURFACES: { readonly withdraw: readonly string[]; readonly deposit: readonly string[] };
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

const BOOT = {
  compat: 'classified',
  compatMode: 'full',
  genesisHash: `0x${'22'.repeat(32)}`,
  finalizedHash: `0x${'11'.repeat(32)}`,
  assetHubVerdict: { kind: 'classified', mode: 'wrong-chain' },
};

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
  // `startsWith("0x")` accepted the bare prefix, which is a hash of nothing. A block hash is 32
  // bytes and the report is machine-written, so the length is a fact rather than a preference.
  for (const hash of ['0x', `0x${'11'.repeat(31)}`, `0x${'11'.repeat(33)}`]) {
    assert.throws(() => rules.assertBootReport({ ...BOOT, finalizedHash: hash }), /no finalized head/, hash);
  }
});

test('a finalized head equal to genesis is a chain that never produced a block', () => {
  // `firstFinalized` waits for a **delivered** finalized head, and a live parachain delivers
  // one derived from relay-finalized para-inclusion. Genesis coming back is what a transport
  // that answers from the value it was opened with looks like, and the classifier above would
  // still say `full` — the verdict describes the runtime, not the block it was read at.
  assert.throws(
    () => rules.assertBootReport({ ...BOOT, finalizedHash: BOOT.genesisHash }),
    /the genesis block/,
  );
  // And the comparison must not go vacuous by the other side going missing.
  for (const genesisHash of [undefined, '', '0x', 42]) {
    assert.throws(() => rules.assertBootReport({ ...BOOT, genesisHash }), /genesis hash/, String(genesisHash));
  }
});

test('the boot leg refuses an Asset Hub CLASSIFIED as anything but `wrong-chain` — 15 §4.8', () => {
  // The same rule as the funding leg's, one leg over. The boot leg attaches and classifies Asset
  // Hub too, and its verdict went into the report as a log line nothing read — so the
  // development-label bug was invisible here even after the funding leg started refusing it.
  for (const mode of ['full', 'restricted', 'unsupported', 'unreachable']) {
    assert.throws(
      () => rules.assertBootReport({ ...BOOT, assetHubVerdict: { kind: 'classified', mode } }),
      /can only ever reach "wrong-chain"/,
      `accepted ${mode}`,
    );
  }
});

test('a boot-time Asset Hub that has not attached yet PASSES, because that is timing', () => {
  // Measured on 2026-08-08: this leg reported `unavailable` at one minute of network age, and
  // the funding leg attached the same chain and read it at block 49 six minutes later. Asset
  // Hub finality derives from relay-finalized para-inclusion, so the wait is the relay's.
  // A flat assertion here would fail the drill on network timing rather than on the client.
  for (const refusal of ['unavailable', 'wrong-chain']) {
    rules.assertBootReport({ ...BOOT, assetHubVerdict: { kind: 'not-attached', refusal } });
  }
  rules.assertBootReport({ ...BOOT, assetHubVerdict: { kind: 'unestablished' } });
});

test('a boot report carrying no Asset Hub verdict at all is refused', () => {
  // Otherwise the rule above goes vacuous the day the producer stops writing the field, which
  // is the failure this whole file was extracted to make impossible.
  for (const verdict of [undefined, 'classified: wrong-chain', {}, { kind: 'invented' }]) {
    assert.throws(
      () => rules.assertBootReport({ ...BOOT, assetHubVerdict: verdict }),
      /Asset Hub verdict/,
      `accepted ${JSON.stringify(verdict)}`,
    );
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
const DEPOSIT_READS = [
  { surface: 'Assets.Account', key: `0x${'a1'.repeat(20)}`, decoded: '0' },
  { surface: 'System.Account', key: `0x${'a2'.repeat(20)}`, decoded: 'assetHubReady=false' },
  { surface: 'Constitution.PhaseFlags', key: `0x${'a3'.repeat(20)}`, decoded: 'sudoPresent=true' },
];
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
    reads: DEPOSIT_READS,
    undecodable: [],
    blocks: ['Asset Hub connection: …'],
  },
};

test('a BLOCKED deposit passes, because 02 §7.7 requires exactly that', () => {
  // The leg must not demand a green deposit. §7.7 requires an unavailable or unpinned Asset Hub
  // to block the flow *with diagnostics*, so a rule insisting on `ready` would fail on the
  // correct behaviour and could only be satisfied by pointing the drill at the real Asset Hub.
  rules.assertFundingReport({
    ...FUNDING,
    deposit: { kind: 'blocked', cause: 'asset-hub-unavailable', reason: 'Asset Hub is not attached.' },
  });
  // …but a blocked leg carrying no diagnostics is not "blocked with diagnostics" (11 E17).
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'blocked', cause: 'asset-hub-unavailable', reason: '' } }),
    /neither ready nor blocked-with-diagnostics/,
  );
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'exploded' } }),
    /neither ready nor blocked-with-diagnostics/,
  );
});

test('only an ASSET HUB refusal excuses a blocked deposit; a local-chain failure does not', () => {
  // 15 §4.8 excuses one thing and names it: 02 §7.7 pins the Asset Hub of the relay a release
  // targets, a locally generated one has its own genesis, so an **absent or unpinned** Asset Hub
  // is the refusal this topology forces. That paragraph also says what the Zombienet row does
  // certify — "the two-chain reader pair, the branded reads, the terminal classification" — and
  // every other blocked cause is one of those three failing.
  for (const cause of ['asset-hub-unavailable', 'asset-hub-wrong-chain']) {
    rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'blocked', cause, reason: 'Asset Hub is not attached.' } });
  }
  // `openDepositLeg` blocks for four further reasons, and the drill must report every one of
  // them. The local one is the sharpest: Asset Hub attached, and the drill still never completed
  // the two-chain read path it advertises.
  for (const cause of ['local-unreadable', 'asset-hub-unreadable', 'classification-failed', 'asset-hub-connect-failed']) {
    assert.throws(
      () =>
        rules.assertFundingReport({
          ...FUNDING,
          deposit: { kind: 'blocked', cause, reason: 'This chain could not be read at a finalized block: …' },
        }),
      /not an Asset Hub refusal/,
      `a deposit blocked on ${cause} was accepted`,
    );
  }
  // And the shape that shipped: any nonempty sentence, with no cause at all, passed as the
  // documented refusal. A report that stops carrying the discriminator fails rather than
  // reverting to that.
  assert.throws(
    () =>
      rules.assertFundingReport({
        ...FUNDING,
        deposit: { kind: 'blocked', reason: 'This chain could not be read at a finalized block: …' },
      }),
    /not an Asset Hub refusal/,
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

test('a ready leg whose reads did not DECODE is a read path that was attempted, not verified', () => {
  // A syntactically valid key was built and a chain answered it — and the answer could not be
  // read. `undecodable` is where a live storage-layout or descriptor mismatch lands, so a rule
  // that only counted attempted reads stayed green on exactly the release-tier failure this
  // leg exists to find.
  assert.throws(
    () =>
      rules.assertFundingReport({
        ...FUNDING,
        withdraw: { ...FUNDING.withdraw, undecodable: ['ForeignAssets.Account(who): trailing bytes'] },
      }),
    /could not decode/,
  );
  assert.throws(
    () =>
      rules.assertFundingReport({
        ...FUNDING,
        deposit: { ...FUNDING.deposit, undecodable: ['Constitution.PhaseFlags: the storage key returned no value'] },
      }),
    /could not decode/,
  );
  // An absent list is not an empty one. A report that stopped carrying the field would otherwise
  // satisfy this rule by omission, which is the same defect one level up.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, undecodable: undefined } }),
    /no undecodable list/,
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

test('a ready deposit carrying any verdict but `wrong-chain` is refused — 15 §4.8', () => {
  // The third instance of this defect in one function. A nonempty string is not a verdict: 15
  // §4.8 rules that `ForeignMode` can only ever reach `wrong-chain` in a Zombienet topology,
  // because 02 §7.7 pins the Asset Hub of the relay a release targets and a locally generated
  // one has its own genesis. So the four other modes are not weather — each is the terminal
  // classification the drill exists to certify, failing.
  //
  // `unreachable` is the one that shipped: `boot.ts` passed the connected spec's id as the
  // chain label, no pin carries that name, and `classifyForeign` answers a label it does not
  // pin with `unreachable` — *retryable*, where the truth is terminal. That regression would
  // leave this leg green with a nonempty-string rule.
  for (const foreignMode of ['full', 'restricted', 'unsupported', 'unreachable', 'unestablished']) {
    assert.throws(
      () => rules.assertFundingReport({ ...FUNDING, deposit: { ...FUNDING.deposit, foreignMode } }),
      /can only ever reach "wrong-chain"/,
      `accepted ${foreignMode}`,
    );
  }
});

test('a ready leg that skipped a required surface is refused, and an extra read is not', () => {
  // **Superset, not exact set.** A dropped read falsifies the drill's claim directly — the path
  // was not walked and the leg said it was. An added read does not: the client may legitimately
  // read more, 02's frozen set grows by design, and an exact-set rule would go red on every
  // correct addition until somebody unblocking themselves loosened it. That is how this
  // function came to accept six foreign verdicts where one is reachable.
  const deposit = { ...FUNDING.deposit, reads: DEPOSIT_READS };
  rules.assertFundingReport({ ...FUNDING, deposit });
  for (const surface of rules.REQUIRED_SURFACES.deposit) {
    assert.throws(
      () =>
        rules.assertFundingReport({
          ...FUNDING,
          deposit: { ...deposit, reads: DEPOSIT_READS.filter((read) => read.surface !== surface) },
        }),
      new RegExp(`never read ${surface.replace('.', '\\.')}`),
      `a deposit leg missing ${surface} was accepted`,
    );
  }
  // The withdraw leg has its own required set, and it is not the deposit leg's.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads: DEPOSIT_READS } }),
    /never read ForeignAssets\.Account/,
  );
  // An extra read passes, which is the half that keeps this a certification rather than a
  // change-detector.
  rules.assertFundingReport({
    ...FUNDING,
    deposit: { ...deposit, reads: [...DEPOSIT_READS, { surface: 'Assets.Asset', key: `0x${'ff'.repeat(20)}` }] },
  });
});

test('the required surfaces ARE the frozen funding set, in both directions', () => {
  // The harness is CommonJS outside the workspace and cannot import `FUNDING_READS`, so it
  // restates the names — the same trade `FORCED_DEPOSIT_REFUSALS` makes for `DepositBlockCause`.
  // What stops a restatement from drifting is this test, not care: every frozen surface must be
  // required by exactly one leg, and every required surface must be a frozen one. A surface
  // added to `FUNDING_READS` therefore fails here, where a person can assign it to a leg, rather
  // than at the release tier where the report would simply carry a read nobody demanded.
  const frozen = [...Object.values(FUNDING_READS.assetHub), ...Object.values(FUNDING_READS.local)];
  const required = [...rules.REQUIRED_SURFACES.withdraw, ...rules.REQUIRED_SURFACES.deposit];
  assert.deepEqual([...required].sort(), [...frozen].sort());
  assert.equal(new Set(required).size, required.length, 'a surface is required by two legs');
});

test('the happy shape passes, so none of the refusals above is refusing everything', () => {
  assert.equal(rules.assertFundingReport(FUNDING), FUNDING);
});
