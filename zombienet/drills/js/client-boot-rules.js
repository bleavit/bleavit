// The drill harness's decisions, with no I/O — F18; drill 14.
//
// `client-boot.js` has shipped **two live-only defects**, and both were decisions rather than
// plumbing: it spawned the bare name `node` (reaching zombienet's embedded Node 18, whose
// symptom was a `SyntaxError` on a correct `import`), and it parsed a leg's whole stdout as
// JSON (which smoldot's worker-thread log callback also writes to, so a 348-second run that had
// succeeded failed with `Unexpected token s in JSON at position 1`). Neither could be caught
// before a release-tier drill run, because the file is CommonJS outside the `app` workspace,
// takes its root from `process.cwd()`, and every function that made a decision also performed
// the I/O around it.
//
// So the decisions live here, as pure functions over values, and `app/tests/chain-client/`
// exercises them per commit. `client-boot.js` keeps the I/O — `spawnSync`, `fs`, the `zombie`
// global — and is left with nothing to get wrong that this file does not decide.
//
// ## Constraints this file must keep
//
//  - **CommonJS, and ES2020 at most.** It is required from a helper the pinned zombienet binary
//    runs under its embedded Node **18.5.0**. `??` and `?.` are fine; `??=` and top-level
//    `await` are not, and neither is any TypeScript.
//  - **No `require` of anything outside Node's builtins, and no I/O.** A test loads this file
//    with `createRequire`, and a module that reached the filesystem on load would have to be
//    given one before it could be asked a question.

'use strict';

/**
 * Whether a probed `node` on PATH may run the client — the Node-18 rule, as a predicate.
 *
 * Two independent tests, and the second is the one that is easy to drop. `process.pkg` is
 * defined **only** inside a pkg single-file binary, so it names the thing being excluded rather
 * than approximating it; the version alone would stop telling an interception from a genuine
 * answer the day zombienet is repackaged on a Node in the admissible major.
 *
 * Major **equality** rather than "at least", because `app/package.json` pins `engines.node` to
 * one closed band (`>=22.18.0 <23`). The floor is `app/.nvmrc`, which is the same file `ci.yml`
 * feeds to `actions/setup-node`, so the drill cannot ask for a Node that CI does not install.
 *
 * @param {string} pinned  the `x.y.z` from `app/.nvmrc`
 * @param {string} version `process.version`, with or without the leading `v`
 * @param {string} packaged `typeof process.pkg` as the probe reported it
 */
function admissibleNode(pinned, version, packaged) {
  const floor = parseVersion(pinned);
  if (floor === undefined) {
    throw new Error(`app/.nvmrc does not hold an x.y.z version: ${JSON.stringify(pinned)}`);
  }
  if (packaged !== 'undefined') return false;
  const got = parseVersion(String(version).replace(/^v/, ''));
  if (got === undefined || got[0] !== floor[0]) return false;
  for (let i = 0; i < 3; i += 1) {
    if (got[i] !== floor[i]) return got[i] > floor[i];
  }
  return true;
}

function parseVersion(text) {
  const parts = String(text).split('.').map((part) => Number.parseInt(part, 10));
  return parts.length === 3 && !parts.some(Number.isNaN) ? parts : undefined;
}

/**
 * The spawned network's directory, from whatever zombienet handed the helper.
 *
 * The **spawned** specs, never `zombienet/specs/out/`: zombienet rewrites the specs it is given
 * before booting them — injecting validator session keys into the relay genesis and registering
 * the parachains — so the generated file and the running chain have different genesis hashes.
 * Pinning one while reading the genesis off the other produces exactly the mismatch the identity
 * check exists to catch, and the client refuses to boot (correctly).
 */
function networkDir(networkInfo, env) {
  const spec =
    (networkInfo && (networkInfo.networkSpecPath || networkInfo.tmpDir)) || (env || {}).ZOMBIE_DIR;
  if (typeof spec === 'string' && spec.length > 0) {
    return spec.endsWith('.json') ? spec.slice(0, spec.lastIndexOf('/')) : spec;
  }
  throw new Error(
    'cannot locate the spawned network directory; zombienet writes the effective chain specs ' +
      'there and the generated specs in zombienet/specs/out/ are a DIFFERENT chain',
  );
}

/**
 * The **state root** of a genesis header, as `export-genesis-head` prints it.
 *
 * Restated here rather than shared with `app/tools/dev-chain-pin.ts`, which decodes the same
 * header and is the one that acts on it: this copy exists only so the harness can refuse an
 * obviously wrong header before spending a subprocess on it, and the two disagreeing is caught
 * by `dev-chain-pin.ts` refusing the value this one passed. It deliberately checks **less** —
 * shape, not semantics — so it can never be the thing that decides what gets pinned.
 */
function looksLikeGenesisHeader(headerHex) {
  if (typeof headerHex !== 'string' || !/^0x[0-9a-f]+$/i.test(headerHex)) return false;
  if (headerHex.length < 2 + 97 * 2) return false;
  // 32 zero bytes of parent hash, then a single-byte compact 0 for the block number.
  return /^0x0{64}00/i.test(headerHex);
}

/**
 * What a leg must be told when it exits 0 and writes no report.
 *
 * A separate function because the alternative — reading the last run's file — is the mistake
 * this drill exists to not make: its whole subject is a check that stopped checking, and a leg
 * that passed on a stale report would be exactly that.
 */
function missingReportError(label, file, stdout) {
  return new Error(`${label} exited 0 but wrote no report to ${file}\n--- stdout ---\n${stdout}`);
}

/**
 * The `boot` leg's acceptance rule — 10 §5.2.
 *
 * Asserts the **mode**, not the wrapper. `CompatVerdict.kind` is `classified | unestablished`,
 * so checking only that a chain answered would pass on a `read-only-incompatible` runtime,
 * which is precisely the regression this leg exists to catch.
 */
function assertBootReport(report) {
  if (!report || typeof report !== 'object') throw new Error(`the boot leg produced no report object`);
  if (report.compat === 'unestablished') {
    throw new Error(`the classifier ran without a chain: ${JSON.stringify(report)}`);
  }
  if (report.compatMode !== 'full') {
    throw new Error(
      `10 §5.2 classified this runtime as ${JSON.stringify(report.compatMode)}, not "full". ` +
        'The drill spec is built from this repository\'s own runtime, so anything else means ' +
        `the frozen critical surface and the runtime disagree: ${JSON.stringify(report)}`,
    );
  }
  if (typeof report.finalizedHash !== 'string' || !report.finalizedHash.startsWith('0x')) {
    throw new Error(`no finalized head was delivered: ${JSON.stringify(report)}`);
  }
  return report;
}

/**
 * The `wrong-chain` leg's acceptance rule — 10 §3.1, `FE-BOOT-003`.
 *
 * Three separate refusals, and each closes a way for this leg to witness nothing:
 * a boot that was not refused at all; a refusal that compared a value with itself; and a
 * refusal about the **relay** pin, which `startTopology` asserts first — so a stale relay spec
 * raises `WrongChainError` too, and a leg accepting it would report FE-BOOT-003 witnessed while
 * the byte it flipped was never reached.
 */
function assertWrongChainReport(report) {
  if (!report || typeof report !== 'object') throw new Error('the wrong-chain leg produced no report object');
  if (report.refused !== true || report.code !== 'FE-BOOT-003') {
    throw new Error(`the corrupted pin was not refused as FE-BOOT-003: ${JSON.stringify(report)}`);
  }
  if (report.expected === report.observed) {
    throw new Error(
      `the refusal compared a value with itself (${report.expected}); the corrupted pin never ` +
        'reached the identity check, so this leg witnesses nothing',
    );
  }
  if (report.role !== 'para' || report.observed !== report.uncorrupted) {
    throw new Error(`the refusal was not about the corrupted parachain pin: ${JSON.stringify(report)}`);
  }
  return report;
}

/**
 * The `funding` leg's acceptance rule — 11 §11.9; 02 §7.7.
 *
 * **A blocked leg is not a failure here, and that is the point.** 02 §7.7 requires an
 * unavailable or unpinned Asset Hub to block the deposit flow *with diagnostics*, so a run that
 * demanded a `ready` deposit would fail on the correct behaviour and could only be satisfied by
 * pointing the drill at the real pinned Asset Hub. What this leg refuses is a report that
 * claims an outcome without having read anything:
 *
 *  - **withdraw must be `ready`.** §11.9.2 and §7.7 both say a withdraw does not depend on
 *    Asset Hub; a blocked withdraw beside a blocked deposit is the *"funding is down"* coupling
 *    those sections exist to forbid, so it fails here rather than being reported as weather.
 *  - **the key this client builds must be the key the runtime published.** A mismatch means
 *    every read below asked about the wrong entry, and an empty answer to the wrong key is
 *    indistinguishable from an honest zero balance.
 *  - **a `ready` leg must carry reads.** An arm with an empty `reads` array is a leg that
 *    reported success without having read anything, which is the one outcome this drill exists
 *    to make impossible.
 *  - **the two legs must be on different chains.** They are read at two independent finalized
 *    blocks on two chains, and one chain answering both is `SameChainError`'s subject: every
 *    Asset Hub figure would be a futarchy-chain read under an Asset Hub label.
 */
function assertFundingReport(report) {
  if (!report || typeof report !== 'object') throw new Error('the funding leg produced no report object');
  if (report.publishedKeyAgrees !== true) {
    throw new Error(
      'the ForeignAssets.Account key this client built is not the key the runtime published, so ' +
        `every funding read asked about the wrong entry: ${JSON.stringify(report.driverInputs)}`,
    );
  }
  const withdraw = report.withdraw || {};
  if (withdraw.kind !== 'ready') {
    throw new Error(
      '11 §11.9.2 and 02 §7.7 both make a withdraw independent of Asset Hub, so it must open on ' +
        `the local chain alone: ${JSON.stringify(withdraw)}`,
    );
  }
  requireReads('withdraw', withdraw);

  const deposit = report.deposit || {};
  if (deposit.kind === 'ready') {
    requireReads('deposit', deposit);
    if (deposit.localChain === deposit.assetHubChain) {
      throw new Error(
        `both deposit readers are on chain ${deposit.localChain}; every Asset Hub figure would ` +
          'be a futarchy-chain read under an Asset Hub label',
      );
    }
    if (typeof deposit.foreignMode !== 'string' || deposit.foreignMode.length === 0) {
      throw new Error(`the deposit leg carries no 02 §7.7 foreign verdict: ${JSON.stringify(deposit)}`);
    }
  } else if (deposit.kind !== 'blocked' || typeof deposit.reason !== 'string' || deposit.reason.length === 0) {
    throw new Error(
      `the deposit leg is neither ready nor blocked-with-diagnostics (11 E17): ${JSON.stringify(deposit)}`,
    );
  }
  return report;
}

function requireReads(leg, arm) {
  if (!Array.isArray(arm.reads) || arm.reads.length === 0) {
    throw new Error(`the ${leg} leg reported ready with no reads at all: ${JSON.stringify(arm)}`);
  }
  for (const read of arm.reads) {
    if (!read || typeof read.key !== 'string' || !read.key.startsWith('0x')) {
      throw new Error(`the ${leg} leg reported a read with no storage key: ${JSON.stringify(read)}`);
    }
  }
}

module.exports = {
  admissibleNode,
  networkDir,
  looksLikeGenesisHeader,
  missingReportError,
  assertBootReport,
  assertWrongChainReport,
  assertFundingReport,
};
