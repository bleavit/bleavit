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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPS_READS, FUNDING_READS } from '@bleavit/features-tx';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface Certification {
  readonly certified: boolean;
  readonly shown: readonly string[];
  readonly missing: readonly string[];
  readonly summary: string;
}

interface HarnessRules {
  admissibleNode(pinned: string, version: string, packaged: string): boolean;
  networkDir(networkInfo: unknown, env: Record<string, string | undefined>): string;
  looksLikeGenesisHeader(headerHex: unknown): boolean;
  missingReportError(label: string, file: string, stdout: string): Error;
  assertBootReport(report: unknown): unknown;
  assertWrongChainReport(report: unknown): unknown;
  /**
   * `tier` is `unknown` on purpose: the harness is JavaScript, so the rule has to refuse an
   * absent or misspelled tier at runtime, and a `string` declaration here would make the one
   * case worth testing unwritable without a banned double assertion.
   */
  assertFundingReport(report: unknown, tier: unknown): unknown;
  fundingCertification(report: unknown): Certification;
  drillTier(env: Record<string, string | undefined>): string;
  /** Exported so this suite can bind the harness's restatement to the frozen `FUNDING_READS`. */
  readonly REQUIRED_SURFACES: { readonly withdraw: readonly string[]; readonly deposit: readonly string[] };
  readonly CERTIFIED_CLAIMS: readonly string[];
}

const load = createRequire(import.meta.url);
const rules: HarnessRules = load(join(APP, '..', 'zombienet', 'drills', 'js', 'client-boot-rules.js'));

/* ------------------------------------------------------- defect 1: zombienet's embedded Node */

test('the pkg Node is rejected on `process.pkg`, not on its version', () => {
  // The whole point of testing `process.pkg` as well as the version: the day zombienet is
  // repackaged on a Node in the admissible major, a version-only rule starts accepting it and
  // the drill silently runs the client under an interpreter that reads ESM as CommonJS.
  assert.equal(rules.admissibleNode('22.19.0', 'v22.19.0', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.19.0', 'v22.19.0', 'object'), false, 'a pkg binary in the pinned version was accepted');
  assert.equal(rules.admissibleNode('22.19.0', 'v18.5.0', 'object'), false);
});

test('the band is closed at both ends, because `engines.node` is', () => {
  // `app/package.json` pins ">=22.19.0 <23" — one band, deliberately closed. "At least the
  // floor" would admit Node 23, which is not a Node CI installs.
  assert.equal(rules.admissibleNode('22.19.0', 'v22.19.1', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.19.0', 'v22.20.0', 'undefined'), true);
  assert.equal(rules.admissibleNode('22.19.0', 'v23.0.0', 'undefined'), false, 'the next major was admitted');
  assert.equal(rules.admissibleNode('22.19.0', 'v22.18.9', 'undefined'), false, 'below the floor was admitted');
  assert.equal(rules.admissibleNode('22.19.0', 'v18.5.0', 'undefined'), false, 'Node 18 was admitted');
});

test('a version that is not one is rejected rather than parsed into something', () => {
  for (const version of ['', 'v22', 'v22.18', 'twenty-two', 'v22.x.0']) {
    assert.equal(rules.admissibleNode('22.19.0', version, 'undefined'), false, `accepted ${JSON.stringify(version)}`);
  }
  // …and a pin this suite cannot read is loud, because it decides every answer above.
  assert.throws(() => rules.admissibleNode('22.19', 'v22.19.0', 'undefined'), /does not hold an x\.y\.z version/);
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

test('a BLOCKED deposit passes at the EXPLORATORY tier, because 02 §7.7 requires exactly that', () => {
  // The lower tier must not demand a green deposit. §7.7 requires an unavailable or unpinned
  // Asset Hub to block the flow *with diagnostics*, and a development Asset Hub that has not
  // finalized inside the connector deadline is a slow machine rather than a client defect. What
  // the tier costs is the certification, not the run — see the release-tier test below.
  rules.assertFundingReport(
    {
      ...FUNDING,
      deposit: { kind: 'blocked', cause: 'asset-hub-unavailable', reason: 'Asset Hub is not attached.' },
    },
    'exploratory',
  );
  // …but a blocked leg carrying no diagnostics is not "blocked with diagnostics" (11 E17).
  assert.throws(
    () =>
      rules.assertFundingReport(
        { ...FUNDING, deposit: { kind: 'blocked', cause: 'asset-hub-unavailable', reason: '' } },
        'exploratory',
      ),
    /neither ready nor blocked-with-diagnostics/,
  );
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, deposit: { kind: 'exploded' } }, 'exploratory'),
    /neither ready nor blocked-with-diagnostics/,
  );
});

test('only an ASSET HUB refusal is environmental; a local-chain failure is a defect at every tier', () => {
  // Two documented environmental refusals and nothing else. 02 §7.7 requires an unavailable or
  // unpinned Asset Hub to block the flow with diagnostics, so a run that hits one is behaving
  // correctly — and 15 §4.8 names what the Zombienet row *certifies* — "the two-chain reader
  // pair, the branded reads, the terminal classification" — none of which such a run reached.
  for (const cause of ['asset-hub-unavailable', 'asset-hub-bundle-pin-mismatch']) {
    rules.assertFundingReport(
      { ...FUNDING, deposit: { kind: 'blocked', cause, reason: 'Asset Hub is not attached.' } },
      'exploratory',
    );
  }
  // `openDepositLeg` blocks for four further reasons, and the drill must report every one of
  // them at **both** tiers: a defect is not weather. The local one is the sharpest: Asset Hub
  // attached, and the drill still never completed the two-chain read path it advertises.
  for (const cause of ['local-unreadable', 'asset-hub-unreadable', 'classification-failed', 'asset-hub-connect-failed']) {
    for (const tier of ['release', 'exploratory']) {
      assert.throws(
        () =>
          rules.assertFundingReport(
            {
              ...FUNDING,
              deposit: { kind: 'blocked', cause, reason: 'This chain could not be read at a finalized block: …' },
            },
            tier,
          ),
        /not an Asset Hub refusal/,
        `a deposit blocked on ${cause} was accepted at the ${tier} tier`,
      );
    }
  }
  // And the shape that shipped: any nonempty sentence, with no cause at all, passed as the
  // documented refusal. A report that stops carrying the discriminator fails rather than
  // reverting to that.
  assert.throws(
    () =>
      rules.assertFundingReport(
        {
          ...FUNDING,
          deposit: { kind: 'blocked', reason: 'This chain could not be read at a finalized block: …' },
        },
        'exploratory',
      ),
    /not an Asset Hub refusal/,
  );
});

test('a BLOCKED withdraw fails, because §11.9.2 says it does not depend on Asset Hub', () => {
  // The asymmetry is the property worth proving live: a blocked withdraw beside a blocked
  // deposit is the "funding is down" coupling 02 §7.7 and §11.9.2 exist to forbid.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { kind: 'blocked', reason: 'Asset Hub is down.' } }, 'release'),
    /independent of Asset Hub/,
  );
});

test('a leg that reported ready without reading anything is the one outcome refused outright', () => {
  for (const reads of [[], undefined, 'two']) {
    assert.throws(
      () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads } }, 'release'),
      /reported ready with no reads at all/,
      `accepted reads=${JSON.stringify(reads)}`,
    );
  }
  // A "read" with no storage key is the same claim wearing an array.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads: [{ surface: 'x' }] } }, 'release'),
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
      rules.assertFundingReport(
        {
          ...FUNDING,
          withdraw: { ...FUNDING.withdraw, undecodable: ['ForeignAssets.Account(who): trailing bytes'] },
        },
        'release',
      ),
    /could not decode/,
  );
  assert.throws(
    () =>
      rules.assertFundingReport(
        {
          ...FUNDING,
          deposit: { ...FUNDING.deposit, undecodable: ['Constitution.PhaseFlags: the storage key returned no value'] },
        },
        'release',
      ),
    /could not decode/,
  );
  // An absent list is not an empty one. A report that stopped carrying the field would otherwise
  // satisfy this rule by omission, which is the same defect one level up.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, undecodable: undefined } }, 'release'),
    /no undecodable list/,
  );
});

test('a key that is not the runtime\'s own published key fails the whole leg', () => {
  // Every read below it asked the chain about the wrong entry, and an empty answer to the
  // wrong key is indistinguishable from an honest zero balance.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, publishedKeyAgrees: false }, 'release'),
    /not the key the runtime published/,
  );
});

test('two deposit readers on one chain are refused — that is `SameChainError`\'s subject', () => {
  assert.throws(
    () =>
      rules.assertFundingReport(
        { ...FUNDING, deposit: { ...FUNDING.deposit, assetHubChain: FUNDING.deposit.localChain } },
        'release',
      ),
    /under an Asset Hub label/,
  );
});

test('a ready deposit with no 02 §7.7 verdict is refused', () => {
  // The verdict is §11.9.1's first precondition row. A leg reporting `ready` without one is
  // reporting that a deposit may be constructed against a chain nothing classified.
  for (const foreignMode of [undefined, '', 42]) {
    assert.throws(
      () => rules.assertFundingReport({ ...FUNDING, deposit: { ...FUNDING.deposit, foreignMode } }, 'release'),
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
      () => rules.assertFundingReport({ ...FUNDING, deposit: { ...FUNDING.deposit, foreignMode } }, 'release'),
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
  rules.assertFundingReport({ ...FUNDING, deposit }, 'release');
  for (const surface of rules.REQUIRED_SURFACES.deposit) {
    assert.throws(
      () =>
        rules.assertFundingReport(
          {
            ...FUNDING,
            deposit: { ...deposit, reads: DEPOSIT_READS.filter((read) => read.surface !== surface) },
          },
          'release',
        ),
      new RegExp(`never read ${surface.replace('.', '\\.')}`),
      `a deposit leg missing ${surface} was accepted`,
    );
  }
  // The withdraw leg has its own required set, and it is not the deposit leg's.
  assert.throws(
    () => rules.assertFundingReport({ ...FUNDING, withdraw: { ...FUNDING.withdraw, reads: DEPOSIT_READS } }, 'release'),
    /never read ForeignAssets\.Account/,
  );
  // An extra read passes, which is the half that keeps this a certification rather than a
  // change-detector.
  rules.assertFundingReport(
    {
      ...FUNDING,
      deposit: { ...deposit, reads: [...DEPOSIT_READS, { surface: 'Assets.Asset', key: `0x${'ff'.repeat(20)}` }] },
    },
    'release',
  );
});

test('the required surfaces ARE the frozen funding set, in both directions', () => {
  // The harness is CommonJS outside the workspace and cannot import `FUNDING_READS`, so it
  // restates the names — the same trade `ENVIRONMENTAL_DEPOSIT_REFUSALS` makes for
  // `DepositBlockCause`. What stops a restatement from drifting is this test, not care: every
  // frozen surface must be required by exactly one leg, and every required surface must be a
  // frozen one. A surface added to `FUNDING_READS` therefore fails here, where a person can
  // assign it to a leg, rather than at the release tier where the report would simply carry a
  // read nobody demanded.
  const frozen = [...Object.values(FUNDING_READS.assetHub), ...Object.values(FUNDING_READS.local)];
  const required = [...rules.REQUIRED_SURFACES.withdraw, ...rules.REQUIRED_SURFACES.deposit];
  assert.deepEqual([...required].sort(), [...frozen].sort());
  assert.equal(new Set(required).size, required.length, 'a surface is required by two legs');
});

test('D-13’s cap surfaces are deliberately OUTSIDE the required set, and stay outside', () => {
  // `CAPS_READS` is a third reader on one chain — `readDepositCaps`, 11 §11.9.1's Phase-3 row —
  // and this drill opens no constitution reader, so requiring its surfaces of a leg would
  // demand a read the run never makes and turn every green drill red. Asserted rather than
  // left implicit, because the test above is a two-way binding and a set sitting beside it
  // with no statement either way is exactly how a surface escapes one.
  //
  // Two consequences, both intended. A caps surface that appears in `REQUIRED_SURFACES`
  // without the drill being extended fails here. And a caps surface moved into
  // `FUNDING_READS` fails the test above, where a person assigns it to a leg — which is what
  // wiring `readDepositCaps` into `drill-client/funding.ts` would properly involve.
  const required: readonly string[] = [
    ...rules.REQUIRED_SURFACES.withdraw,
    ...rules.REQUIRED_SURFACES.deposit,
  ];
  for (const surface of Object.values(CAPS_READS)) {
    assert.ok(
      !required.includes(surface),
      `${surface} is required of a drill leg that never opens a constitution reader`,
    );
  }
  // `params` is the cross-check *prefix* and `Constitution.Params` is a real frozen item, so
  // the exclusion is about which reader performs it, never about the surface being unfrozen.
  assert.equal(CAPS_READS.params, 'Constitution.Params');
});

test('the happy shape passes, so none of the refusals above is refusing everything', () => {
  assert.equal(rules.assertFundingReport(FUNDING, 'release'), FUNDING);
});

/* ------------------------------------ certification versus environmental refusal (round 3) */

test('the release tier REFUSES a run that took an environmental refusal — 15 §4.8', () => {
  // The finding this split answers. `openDepositLeg` returns both documented refusals **before**
  // it opens the Asset Hub reader, builds `fundingReaders` or calls `classifyAssetHub`, so a run
  // that takes one exercised none of the three things 15 §4.8 says this row certifies — and the
  // drill reported it as a pass. Requiring `ready` at every tier was the wrong fix: a development
  // Asset Hub that has not finalized inside the connector deadline is a slow machine, and a drill
  // that goes red on that gets disabled. So the claim splits from the outcome.
  for (const cause of ['asset-hub-unavailable', 'asset-hub-bundle-pin-mismatch']) {
    const refused = { ...FUNDING, deposit: { kind: 'blocked', cause, reason: 'Asset Hub is not attached.' } };
    assert.throws(() => rules.assertFundingReport(refused, 'release'), /certifies nothing/, `accepted ${cause}`);
    // …and the same report is a legitimate outcome one tier down.
    rules.assertFundingReport(refused, 'exploratory');
  }
});

test('the certification names WHICH claims a run showed, at either tier', () => {
  // The distinction has to be readable, not merely enforced: all three rounds of this defect
  // share one shape — a report that could not tell a run which did the work from one which did
  // not. A boolean would repeat that mistake one level up.
  const shown = rules.fundingCertification(FUNDING);
  assert.equal(shown.certified, true);
  assert.deepEqual([...shown.shown], [...rules.CERTIFIED_CLAIMS]);
  assert.deepEqual(shown.missing, []);
  assert.match(shown.summary, /CERTIFIED/);

  const refused = rules.fundingCertification({
    ...FUNDING,
    deposit: { kind: 'blocked', cause: 'asset-hub-unavailable', reason: 'Asset Hub is not attached.' },
  });
  assert.equal(refused.certified, false);
  assert.deepEqual(refused.shown, []);
  assert.deepEqual([...refused.missing], [...rules.CERTIFIED_CLAIMS]);
  assert.match(refused.summary, /NOT CERTIFYING/);
  // The reason a run did not certify belongs in the line a person reads, not only in the rule.
  assert.match(refused.summary, /asset-hub-unavailable/);
});

test('the certification is computed from the report, not inherited from the refusals above', () => {
  // Deliberately overlapping with `assertFundingReport`, and the overlap is the point: this is a
  // positive statement of what a run proved, where every rule above is a refusal. Either one
  // being loosened leaves the other holding the line, so a `ready` deposit missing a claim is
  // still reported as missing it.
  const partial = {
    ...FUNDING,
    deposit: { ...FUNDING.deposit, assetHubChain: FUNDING.deposit.localChain, foreignMode: 'unreachable', reads: [] },
  };
  const verdict = rules.fundingCertification(partial);
  assert.equal(verdict.certified, false);
  assert.deepEqual([...verdict.missing], [...rules.CERTIFIED_CLAIMS]);
});

test('the harness WIRES the tier and prints the certification — read from its source', () => {
  // Deliberately lexical, and the reason is this file's own premise: `client-boot.js` performs
  // the I/O, so nothing per commit can execute it, and every rule in `client-boot-rules.js` is
  // worth exactly as much as the harness calling it. The three rounds of review on this leg all
  // ended in a rule; none of them could see whether the rule was still wired.
  //
  // Kept to names rather than to a call shape, so renaming a local variable is not a false red —
  // a check that cries wolf on correct changes is one somebody loosens. What it does catch is the
  // realistic regression: the tier read, the assertion or the printed verdict quietly going away,
  // or a hardcoded lower tier appearing where the environment should decide.
  const harness = readFileSync(join(APP, '..', 'zombienet', 'drills', 'js', 'client-boot.js'), 'utf8');
  for (const name of ['rules.drillTier(process.env)', 'rules.assertFundingReport(', 'rules.fundingCertification(']) {
    assert.ok(harness.includes(name), `the funding leg no longer calls ${name}`);
  }
  assert.match(harness, /funding certification:/, 'the drill stopped printing what it certified');
  assert.ok(
    !/['"]exploratory['"]/.test(harness),
    'the harness names the lower tier itself; the tier must come from the environment, and a ' +
      'hardcoded one is a release drill that certifies nothing and reports success',
  );
});

test('the tier defaults to `release`, and an unknown one is refused rather than assumed', () => {
  // Fail-closed in the one direction that matters: a run that says nothing is held to the
  // certifying standard, and the escape has to be typed by a person. An unrecognised value is
  // a typo, and silently treating it as the lower tier would turn a typo into a drill that
  // certifies nothing and says it passed.
  assert.equal(rules.drillTier({}), 'release');
  assert.equal(rules.drillTier({ BLEAVIT_DRILL_TIER: '' }), 'release');
  assert.equal(rules.drillTier({ BLEAVIT_DRILL_TIER: 'release' }), 'release');
  assert.equal(rules.drillTier({ BLEAVIT_DRILL_TIER: 'exploratory' }), 'exploratory');
  for (const tier of ['g1', 'Release', 'nightly', 'true']) {
    assert.throws(() => rules.drillTier({ BLEAVIT_DRILL_TIER: tier }), /BLEAVIT_DRILL_TIER/, `accepted ${tier}`);
  }
  // The rule itself refuses a tier nobody declared, so a harness edit that drops the argument
  // fails loudly instead of picking one.
  assert.throws(() => rules.assertFundingReport(FUNDING, undefined), /tier/);
  assert.throws(() => rules.assertFundingReport(FUNDING, 'whenever'), /tier/);
});
