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
 * The **only** foreign verdict a Zombienet topology can produce — 15 §4.8; 02 §7.7.
 *
 * The same paragraph, read the other way round. It says `ForeignMode` *"can only ever reach
 * `wrong-chain` in any Zombienet topology, however correct the client is"* — and that is a
 * statement about **every** run of this drill, not an excuse for one outcome. So the four other
 * modes are each a defect rather than weather: `full`, `restricted` and `unsupported` all claim
 * the genesis matched a pin no local chain can carry, and `unreachable` claims the classifier
 * never got an answer from a chain whose reader opened one line earlier.
 *
 * `unreachable` is the one that shipped, which is why this is a value rather than a shape.
 * `boot.ts` passed the connected spec's id (`asset-hub-paseo-local`) as the chain label,
 * `classifyForeign` finds its pin by label, and a label naming no pin answers `unreachable` —
 * *retryable*, where a locally generated Asset Hub is terminally the wrong chain. 15 §4.8 names
 * *"the terminal classification"* among the four things the Zombienet row does certify, and a
 * rule accepting any nonempty string certifies none of it.
 *
 * **`unreachable` has a second cause, and refusing it is still right.** `classifyForeign` also
 * answers `unreachable` when no genesis was observed, which happens if
 * `assetHubCompatProvider`'s `attachAssetHub({ reuse: false })` — a *second* handle beside the
 * reader's — fails. Both legs reach the classifier only after Asset Hub attached and delivered
 * a finalized block, so a second attach failing there is a defect this drill should report
 * rather than the relay sync time it must not fail on. The message below names both causes,
 * because the two verdicts are one word and a person reading a red drill needs the difference.
 *
 * **`wrong-chain` is also two facts, and only this one is the verdict.** The deposit leg's
 * blocked cause `asset-hub-bundle-pin-mismatch` is `attachAssetHub` refusing the **bundle** pin —
 * in this drill the development pin generated from the running node — and it is a defect, where
 * this verdict is the expected terminal outcome against the **release** pin. See {@link
 * WRONG_CHAIN_FACTS}; the two are spelled differently for exactly that reason.
 *
 * **Both legs classify Asset Hub**, so both are bound to this constant. The funding leg's
 * verdict rides on a `ready` deposit; the boot leg's is {@link assertAssetHubVerdict}.
 */
const ONLY_REACHABLE_FOREIGN_MODE = 'wrong-chain';

/** Said once, because both legs raise it about the same one-word verdict. */
const UNREACHABLE_CAUSES =
  'An "unreachable" verdict here is one of two things and they are not the same defect: the ' +
  'chain label matched no pin (10 §5.2 finds its pin by label, and the connected spec id is ' +
  'not one), or `assetHubCompatProvider` failed to attach its second handle to a chain this ' +
  'run had already synced';

/**
 * The other one-word collision, said once — and the two facts are opposites.
 *
 * `wrong-chain` names two different comparisons. `attachAssetHub` compares the genesis the light
 * client reports against **`BundledChain.pinned.genesisHash`** — in this drill the development
 * pin `dev-chain-pin.ts` built from the running node minutes earlier — and reports its refusal as
 * the deposit cause `asset-hub-bundle-pin-mismatch`. 10 §5.2's `ForeignMode` compares the same
 * genesis against the **release** pin 02 §7.7 freezes, and reports `wrong-chain`.
 *
 * In a Zombienet topology the first is a harness or topology defect — the pin document and the
 * chain it was generated from disagree — and the second is the expected terminal outcome. So the
 * cause carries the distinct name and the verdict keeps `wrong-chain`, because 10 §5.2 owns it.
 */
const WRONG_CHAIN_FACTS =
  '"wrong-chain" is two facts in this drill and only one of them is expected: the deposit cause ' +
  '`asset-hub-bundle-pin-mismatch` is `attachAssetHub` refusing the DEVELOPMENT pin this run ' +
  'generated from the running node, while the 10 §5.2 verdict `wrong-chain` is the RELEASE pin ' +
  '02 §7.7 freezes, which a locally generated Asset Hub can never match';

/** A 32-byte hash, as every hash in these reports is. */
const HASH = /^0x[0-9a-f]{64}$/i;

/**
 * The boot leg's Asset Hub verdict — 15 §4.8, and **conditionally**.
 *
 * `not-attached` must pass, and that is measured rather than cautious. Asset Hub finality
 * derives from relay-finalized para-inclusion, so its first finalized block cannot arrive before
 * the relay has synced: on 2026-08-08 this leg reported `unavailable` at one minute of network
 * age while the `funding` leg attached the same chain and read it at block 49 six minutes later.
 * A flat assertion would fail the drill on the relay's sync time rather than on anything the
 * client did, and a drill that fails for reasons its subject cannot control gets disabled.
 *
 * `unestablished` passes for the narrower reason that 15 §4.8 constrains what a **classified**
 * Asset Hub can be, and says nothing about one this run never established.
 *
 * What must not pass is a *classification* that no local topology can produce. The arms are
 * checked against a closed list first, so the rule cannot go quiet the day the producer stops
 * writing the field — which is how the funding leg's verdict went unchecked for a whole
 * milestone.
 */
const ASSET_HUB_VERDICT_KINDS = ['classified', 'unestablished', 'not-attached'];

function assertAssetHubVerdict(report) {
  const verdict = report.assetHubVerdict;
  if (!verdict || typeof verdict !== 'object' || !ASSET_HUB_VERDICT_KINDS.includes(verdict.kind)) {
    throw new Error(
      'the boot leg carries no Asset Hub verdict this rule can read. It must be one of ' +
        `${JSON.stringify(ASSET_HUB_VERDICT_KINDS)} — a sentence is not a verdict, and a pin ` +
        `document with no Asset Hub role is a boot that never classified one: ${JSON.stringify(report)}`,
    );
  }
  if (verdict.kind === 'classified' && verdict.mode !== ONLY_REACHABLE_FOREIGN_MODE) {
    throw new Error(
      `the boot leg classified this Asset Hub as ${JSON.stringify(verdict.mode)}. 15 §4.8 rules ` +
        'that a locally generated Asset Hub has its own genesis by construction, so the 02 §7.7 ' +
        `verdict can only ever reach "wrong-chain" here. ${UNREACHABLE_CAUSES}: ` +
        JSON.stringify(report),
    );
  }
}

/**
 * The `boot` leg's acceptance rule — 10 §5.2; 15 §4.8.
 *
 * Asserts the **mode**, not the wrapper. `CompatVerdict.kind` is `classified | unestablished`,
 * so checking only that a chain answered would pass on a `read-only-incompatible` runtime,
 * which is precisely the regression this leg exists to catch.
 *
 * The finalized head is asserted as a **value**, twice. A 32-byte length, because
 * `startsWith("0x")` accepted the bare prefix — a hash of nothing. And *not the genesis block*,
 * because `firstFinalized` waits for a delivered head derived from relay-finalized
 * para-inclusion: genesis coming back is what a transport answering from the value it was
 * opened with looks like, and 10 §5.2's verdict would still read `full`, since it describes the
 * runtime rather than the block it was read at.
 */
function assertBootReport(report) {
  if (!report || typeof report !== 'object') throw new Error(`the boot leg produced no report object`);
  // Both non-verdict kinds, named apart from the mode check below. `compatMode !== 'full'`
  // already refuses either, but it refuses them as *a wrong mode*, and neither is a mode: a
  // boot that never reached a chain and one that classified it `restricted` are different
  // failures, and the drill is read by whoever is holding the pager.
  if (report.compat === 'unestablished' || report.compat === 'not-attempted') {
    throw new Error(`the classifier ran without a chain: ${JSON.stringify(report)}`);
  }
  if (report.compatMode !== 'full') {
    throw new Error(
      `10 §5.2 classified this runtime as ${JSON.stringify(report.compatMode)}, not "full". ` +
        'The drill spec is built from this repository\'s own runtime, so anything else means ' +
        `the frozen critical surface and the runtime disagree: ${JSON.stringify(report)}`,
    );
  }
  if (typeof report.finalizedHash !== 'string' || !HASH.test(report.finalizedHash)) {
    throw new Error(`no finalized head was delivered: ${JSON.stringify(report)}`);
  }
  // Asserted rather than assumed present: the comparison below is the whole check, and a report
  // that stopped carrying one side would pass it while comparing nothing.
  if (typeof report.genesisHash !== 'string' || !HASH.test(report.genesisHash)) {
    throw new Error(`the boot leg carries no genesis hash to compare its head against: ${JSON.stringify(report)}`);
  }
  if (report.finalizedHash.toLowerCase() === report.genesisHash.toLowerCase()) {
    throw new Error(
      'the finalized head is the genesis block, so this chain never produced one. A delivered ' +
        'finalized head derives from relay-finalized para-inclusion, and 10 §5.2 would classify ' +
        `this runtime "full" either way: ${JSON.stringify(report)}`,
    );
  }
  assertAssetHubVerdict(report);
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
 * The deposit-leg refusals that are **environmental** rather than defects — 02 §7.7; 15 §4.8.
 *
 * **Exactly two, and they are named rather than described.** 02 §7.7 requires an unavailable or
 * unpinned Asset Hub to block the funding flow with diagnostics, so a run that takes one of these
 * is watching the client behave correctly against a condition it cannot change: a development
 * Asset Hub that has not finalized inside the connector deadline is a slow machine, not a client
 * defect, and a drill that goes red on a slow machine gets disabled.
 *
 * **They are not, however, a pass at the release tier, and that was this list's first defect.**
 * `openDepositLeg` returns both of them the moment `connectAssetHub` answers — *before* it opens
 * the Asset Hub reader, before `fundingReaders` builds the pair, and before `classifyAssetHub`
 * runs. So a run that takes one exercised **none** of the three things 15 §4.8 says the Zombienet
 * row certifies. Admitting them as a pass is what let a release-tier drill go green having done
 * no work. The two claims are therefore split rather than conflated: see {@link
 * fundingCertification} and {@link assertFundingReport}'s `tier`.
 *
 * That paragraph says what the row *does* certify — *"the identity check, the two-chain reader
 * pair, the branded reads, the terminal classification"* — and every other blocked cause is one
 * of those four failing outright. `local-unreadable` is the sharpest: Asset Hub attached and
 * answered, and the leg still blocked, on **this** chain, which the withdraw leg immediately
 * above it has just read successfully. Those stay refused at every tier, because a defect is not
 * weather.
 *
 * A closed list rather than a prefix test on `asset-hub-`, because two of the four Asset Hub
 * causes are not refusals by the Asset Hub: a chain that attached and then could not be read,
 * and a classifier that threw, are defects wearing an Asset Hub name. A cause added later is
 * refused until somebody decides it belongs here, which is the safe direction for a list whose
 * whole job is to be narrow.
 *
 * `asset-hub-bundle-pin-mismatch` is the connector-level refusal — see {@link WRONG_CHAIN_FACTS}
 * for why it is not spelled `wrong-chain`. It is admitted here because 02 §7.7 groups it with the
 * unavailable case as a condition the client must report rather than crash on; in this topology
 * it would additionally be a harness defect, which the certification below makes visible instead
 * of hiding behind a green run.
 */
const ENVIRONMENTAL_DEPOSIT_REFUSALS = ['asset-hub-unavailable', 'asset-hub-bundle-pin-mismatch'];

/**
 * The tiers this harness distinguishes, and the difference is what a run is allowed to claim.
 *
 * `release` is the certifying tier: `tools/env/suites.json` files drill 14 there, `release.yml`
 * runs it, and the whole point of spawning three chains is the claim that the deposit path was
 * walked. `exploratory` is a person running the drill by hand against whatever machine they
 * have; the documented environmental refusals stay legitimate outcomes there, and a run that
 * takes one is reported as **not certifying** rather than as passing.
 */
const DRILL_TIERS = ['release', 'exploratory'];

/** Where the tier comes from. Absent means `release` — see {@link drillTier}. */
const DRILL_TIER_VAR = 'BLEAVIT_DRILL_TIER';

/**
 * The tier this run is held to, from the environment — fail-closed in both directions.
 *
 * **Absent means `release`.** A run that does not declare itself is held to the certifying
 * standard, so forgetting the variable costs a red drill rather than a green one that proved
 * nothing. **An unrecognised value throws.** It is a typo, and treating a typo as the lower tier
 * would turn one into a drill that certifies nothing and reports success — which is the exact
 * failure this whole file exists to make impossible.
 */
function drillTier(env) {
  const raw = ((env || {})[DRILL_TIER_VAR] ?? '').trim();
  if (raw === '') return 'release';
  if (!DRILL_TIERS.includes(raw)) {
    throw new Error(
      `${DRILL_TIER_VAR}=${JSON.stringify(raw)} is not a tier this drill knows. It must be one of ` +
        `${JSON.stringify(DRILL_TIERS)}, or unset for "release". An unset variable is the ` +
        'certifying tier deliberately: a run that does not say what it is claiming is held to the ' +
        'strictest reading.',
    );
  }
  return raw;
}

/**
 * What 15 §4.8 says this leg certifies, as the claims a report either shows or does not.
 *
 * Three rather than four. The paragraph names *"the identity check, the two-chain reader pair,
 * the branded reads, the terminal classification"*, and the first of those is the **`wrong-chain`
 * leg's** — `assertWrongChainReport`, a corrupted parachain pin refused as FE-BOOT-003. The
 * funding leg carries the other three, and the drill as a whole covers the four.
 */
const CERTIFIED_CLAIMS = ['the two-chain reader pair', 'the branded reads', 'the terminal classification'];

/**
 * The surfaces each leg must have read, per leg — 02 §7.7; 11 §11.9; 15 §4.8.
 *
 * **A superset rule, and the asymmetry is the point.** A *dropped* read falsifies this drill's
 * claim directly: the funding path was not walked and the leg reported that it was. An *added*
 * read does not — a client may legitimately read more, and 02's frozen set grows by design. An
 * exact-set rule would therefore go red on every correct addition, and a check that cries wolf
 * on correct changes gets loosened by whoever is unblocking themselves that day. This function
 * accepting six foreign verdicts where one is reachable is what that looks like afterwards.
 *
 * Split per leg because the legs are not two halves of one read set. The withdraw leg takes no
 * Asset Hub reader at all (11 §11.9.2), and the deposit leg reads Asset Hub's two surfaces plus
 * this chain's `PhaseFlags` — so a rule keyed on "local" and "foreign" would demand the wrong
 * things of both.
 *
 * The names are **restated** here rather than imported, because this module may require nothing
 * outside Node's builtins. What stops a restatement from drifting is not care but
 * `drill-harness-rules.test.ts`, which asserts this object against the frozen `FUNDING_READS` in
 * both directions — so a surface added there fails per commit, where a person can assign it to a
 * leg, rather than at the release tier where the report would carry a read nobody demanded.
 */
const REQUIRED_SURFACES = {
  withdraw: ['ForeignAssets.Account'],
  deposit: ['Assets.Account', 'System.Account', 'Constitution.PhaseFlags'],
};

/**
 * What this run **certified**, as three named claims — 15 §4.8; 02 §7.7.
 *
 * **A separate, positive statement, deliberately overlapping the refusals below.** Every other
 * rule in this file is a refusal, and a refusal answers *"was anything wrong?"* rather than
 * *"what was proved?"*. Three rounds of review on this one function found the same shape each
 * time — a check that could not fail — and each fix left the underlying property unproven,
 * because nothing anywhere stated it. This does, from the report's own fields, so a later
 * loosening of one side still leaves the other holding the line.
 *
 * It is also what the drill **prints**. The failure all three rounds share is that a report could
 * not tell a run which did the work from one which did not, and a pass/fail bit cannot say which;
 * `missing` names the claims a run did not reach, in the words 15 §4.8 uses for them.
 *
 * Pure and total: it never throws, so it can describe a report that {@link assertFundingReport}
 * is about to refuse.
 */
function fundingCertification(report) {
  const deposit = (report && typeof report === 'object' && report.deposit) || {};
  const ready = deposit.kind === 'ready';
  const reads = Array.isArray(deposit.reads) ? deposit.reads : [];
  // Keyed reads only. A surface named beside no storage key is a claim, not a read — the same
  // distinction `requireReads` draws, restated here so this function is a complete statement on
  // its own rather than one that leans on a refusal running first.
  const surfaces = reads
    .filter((read) => read && typeof read.key === 'string' && read.key.startsWith('0x'))
    .map((read) => read.surface);
  const chain = (value) => typeof value === 'string' && value.length > 0;

  const held = [
    ready && chain(deposit.localChain) && chain(deposit.assetHubChain) && deposit.localChain !== deposit.assetHubChain,
    ready &&
      REQUIRED_SURFACES.deposit.every((required) => surfaces.includes(required)) &&
      Array.isArray(deposit.undecodable) &&
      deposit.undecodable.length === 0,
    ready && deposit.foreignMode === ONLY_REACHABLE_FOREIGN_MODE,
  ];
  const shown = CERTIFIED_CLAIMS.filter((_, index) => held[index]);
  const missing = CERTIFIED_CLAIMS.filter((_, index) => !held[index]);

  // Why it did not certify, in the line a person reads. A blocked leg says so with its cause,
  // because that is the whole of what happened; a `ready` leg that fell short names the claims.
  const because_ = ready
    ? `the leg was ready but did not show ${missing.join(', ')}`
    : `the deposit leg blocked on ${JSON.stringify(deposit.cause)}, so it opened no Asset Hub ` +
      'reader, built no reader pair and never reached the 10 §5.2 classifier';
  return {
    certified: missing.length === 0,
    shown,
    missing,
    summary:
      missing.length === 0
        ? `CERTIFIED — this run showed ${shown.join(', ')} (15 §4.8)`
        : `NOT CERTIFYING — ${because_}. 15 §4.8's Zombienet row is unproven by this run`,
  };
}

/**
 * The `funding` leg's acceptance rule — 11 §11.9; 02 §7.7; 15 §4.8.
 *
 * **The tier decides whether a blocked deposit is an outcome or a failure, and nothing else
 * does.** 02 §7.7 requires an unavailable or unpinned Asset Hub to block the deposit flow *with
 * diagnostics*, and a development Asset Hub that has not finalized inside the connector deadline
 * is a slow machine rather than a client defect — so demanding `ready` at every tier would fail
 * the drill on genuine environmental conditions, and a drill that does that gets disabled. At the
 * **release** tier the claim is different: the run exists to prove the path was walked, so an
 * environmental refusal is a failure there and {@link fundingCertification} must hold. At the
 * **exploratory** tier the refusal passes and the run is reported as not certifying.
 *
 * Every structural rule below applies at both tiers. What this leg refuses regardless is a report
 * that claims an outcome without having read anything:
 *
 *  - **withdraw must be `ready`.** §11.9.2 and §7.7 both say a withdraw does not depend on
 *    Asset Hub; a blocked withdraw beside a blocked deposit is the *"funding is down"* coupling
 *    those sections exist to forbid, so it fails here rather than being reported as weather.
 *  - **the key this client builds must be the key the runtime published.** A mismatch means
 *    every read below asked about the wrong entry, and an empty answer to the wrong key is
 *    indistinguishable from an honest zero balance.
 *  - **a `ready` leg must carry reads, and they must have decoded.** See {@link requireReads}.
 *  - **the two legs must be on different chains.** They are read at two independent finalized
 *    blocks on two chains, and one chain answering both is `SameChainError`'s subject: every
 *    Asset Hub figure would be a futarchy-chain read under an Asset Hub label.
 *  - **a blocked deposit must be one of the two environmental refusals.** See
 *    {@link ENVIRONMENTAL_DEPOSIT_REFUSALS}. Until this rule existed, any nonempty sentence
 *    passed — so a second local `FinalizedReader.open` that failed left `ready` withdraw beside a
 *    `blocked` deposit and read exactly like the expected Asset Hub refusal, and drill 14 could
 *    pass without ever completing the two-chain deposit read path it advertises.
 *  - **a ready deposit's verdict must be the one this topology forces.** See
 *    {@link ONLY_REACHABLE_FOREIGN_MODE}. The same defect as the row above, one field over: a
 *    nonempty string admitted `full`, `restricted`, `unsupported` and `unreachable` alike, so
 *    restoring the development-label bug — which reported a chain that had attached and
 *    answered as `unreachable` — would leave this leg green.
 *  - **at the release tier, the run must have certified.** See {@link fundingCertification}.
 *    Every rule above is satisfied by a report whose deposit blocked before a single Asset Hub
 *    read, which is how the previous two fixes each left this leg's own property unproven.
 *
 * @param report the leg's JSON report, as the driver wrote it
 * @param tier   {@link DRILL_TIERS} — required, and an unknown one throws rather than defaulting
 */
function assertFundingReport(report, tier) {
  // First, so a harness edit that drops the argument fails loudly rather than picking a tier.
  if (!DRILL_TIERS.includes(tier)) {
    throw new Error(
      `assertFundingReport was given the tier ${JSON.stringify(tier)}, which is not one of ` +
        `${JSON.stringify(DRILL_TIERS)}. The tier decides whether an environmental refusal is an ` +
        'outcome or a failure, so it is required rather than defaulted here; `drillTier` is what ' +
        'reads it from the environment and defaults it to "release".',
    );
  }
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
    if (deposit.foreignMode !== ONLY_REACHABLE_FOREIGN_MODE) {
      throw new Error(
        `the deposit leg classified this Asset Hub as ${JSON.stringify(deposit.foreignMode)}. ` +
          '15 §4.8 rules that a locally generated Asset Hub has its own genesis by construction, ' +
          'so the 02 §7.7 verdict can only ever reach "wrong-chain" here — every other mode is ' +
          `the terminal classification this leg certifies, failing. ${UNREACHABLE_CAUSES}. ` +
          `${WRONG_CHAIN_FACTS}: ${JSON.stringify(deposit)}`,
      );
    }
  } else {
    if (deposit.kind !== 'blocked' || typeof deposit.reason !== 'string' || deposit.reason.length === 0) {
      throw new Error(
        `the deposit leg is neither ready nor blocked-with-diagnostics (11 E17): ${JSON.stringify(deposit)}`,
      );
    }
    if (!ENVIRONMENTAL_DEPOSIT_REFUSALS.includes(deposit.cause)) {
      throw new Error(
        `the deposit leg blocked on ${JSON.stringify(deposit.cause)}, which is not an Asset Hub ` +
          'refusal any topology forces. 02 §7.7 requires an absent or unpinned Asset Hub to block ' +
          'the flow with diagnostics and says nothing about the rest, because that is the one ' +
          'outcome no client correctness can change; a reader that did not open or a classifier ' +
          `that threw is a defect this drill reports at every tier. ${WRONG_CHAIN_FACTS}: ` +
          JSON.stringify(deposit),
      );
    }
  }

  // The tier's whole job, and the last of the three rounds this function has been through. Every
  // rule above is satisfied by a report whose deposit blocked before a single Asset Hub read.
  const certification = fundingCertification(report);
  if (tier === 'release' && !certification.certified) {
    throw new Error(
      `${certification.summary}. A release-tier run of this drill exists to prove the deposit ` +
        'path was walked: 15 §4.8 says the Zombienet row certifies the identity check, the ' +
        'two-chain reader pair, the branded reads and the terminal classification, and this run ' +
        `certifies nothing of the last three. \`openDepositLeg\` returns both of ` +
        `${JSON.stringify(ENVIRONMENTAL_DEPOSIT_REFUSALS)} before it opens the Asset Hub reader, ` +
        'before `fundingReaders` and before `classifyAssetHub`, so accepting one here is ' +
        'accepting a green drill that did none of the work. Run it at the exploratory tier ' +
        `(${DRILL_TIER_VAR}=exploratory) if the machine cannot supply an Asset Hub, and read the ` +
        `result as what it is. ${WRONG_CHAIN_FACTS}: ${JSON.stringify(report.deposit)}`,
    );
  }
  return report;
}

/**
 * What a `ready` arm must carry — and *decoding* is half of it.
 *
 * Three separate claims, and the third was missing:
 *
 *  - **reads at all.** An empty `reads` array is a leg that reported success without having
 *    read anything, which is the one outcome this drill exists to make impossible.
 *  - **a storage key on each.** The same claim wearing an array.
 *  - **nothing undecodable.** A key was built, a chain answered it, and the answer could not be
 *    read — which is where a live storage-layout or descriptor mismatch lands, and the exact
 *    failure a release-tier run is worth spawning three chains for. Counting *attempted* reads
 *    passed such a run, so `ForeignAssets.Account`, `Assets.Account`, `System.Account` or
 *    `PhaseFlags` could each be undecodable with the drill green. It is refused here rather
 *    than in the client: an undecodable read is INV-FE-12's correct **client** behaviour —
 *    render it raw with a warning, never guess — and a *drill* accepting it certifies nothing.
 *  - **the surfaces this leg exists to read.** See {@link REQUIRED_SURFACES}. The three claims
 *    above are all satisfied by *any* nonempty array of keyed reads, so a leg that stopped
 *    reading Asset Hub's balance entirely and kept one local read passed every one of them.
 */
function requireReads(leg, arm) {
  if (!Array.isArray(arm.reads) || arm.reads.length === 0) {
    throw new Error(`the ${leg} leg reported ready with no reads at all: ${JSON.stringify(arm)}`);
  }
  for (const read of arm.reads) {
    if (!read || typeof read.key !== 'string' || !read.key.startsWith('0x')) {
      throw new Error(`the ${leg} leg reported a read with no storage key: ${JSON.stringify(read)}`);
    }
  }
  const surfaces = arm.reads.map((read) => read.surface);
  for (const required of REQUIRED_SURFACES[leg]) {
    if (!surfaces.includes(required)) {
      throw new Error(
        `the ${leg} leg reported ready but never read ${required}, which 02 §7.7 and 11 §11.9 ` +
          'put on this leg. A key built for one surface says nothing about another, so this run ' +
          `attempted part of the funding path and reported all of it: ${JSON.stringify(surfaces)}`,
      );
    }
  }
  // An absent list is not an empty one: a report that stopped carrying the field would
  // otherwise satisfy this rule by omission, which is the same defect one level up.
  if (!Array.isArray(arm.undecodable)) {
    throw new Error(`the ${leg} leg reported ready with no undecodable list at all: ${JSON.stringify(arm)}`);
  }
  if (arm.undecodable.length > 0) {
    throw new Error(
      `the ${leg} leg could not decode ${arm.undecodable.length} of its reads, so this run ` +
        'attempted the funding read path rather than verifying it: ' +
        JSON.stringify(arm.undecodable),
    );
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
  // The tier, and what a run proved. `client-boot.js` reads the first from the environment and
  // prints the second, because a drill whose only output is pass/fail cannot tell a run that
  // walked the deposit path from one that refused before opening a reader.
  drillTier,
  fundingCertification,
  DRILL_TIERS,
  CERTIFIED_CLAIMS,
  // Exported for one reason: `drill-harness-rules.test.ts` binds this restatement to the frozen
  // `FUNDING_READS`. Nothing in the drill reads it from here.
  REQUIRED_SURFACES,
};
