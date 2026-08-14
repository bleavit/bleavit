// F27 / F18 / 15 §4.8 — the canonical client's real light client, against this topology.
//
// Four legs, run in order by `14-client-boot.zndsl`:
//
//   pin          read each chain's genesis hash and listen addresses, trim the Asset Hub
//                genesis to its state root, then build the development pin with
//                `app/tools/dev-chain-pin.ts`
//   boot         start smoldot, sync relay + parachain, classify both runtimes
//   funding      open 11 §11.9's withdraw and deposit legs over the live chains and read
//                the four frozen surfaces behind them (F18)
//   wrong-chain  the same boot with one byte of the parachain genesis pin flipped, which
//                MUST be refused (10 §3.1 FE-BOOT-003, terminal, no override)
//
// The legs are independent — `wrong-chain` boots a client that refuses and leaves nothing
// behind — and `funding` runs **before** it deliberately. `wrong-chain` is red for a client
// defect that has nothing to do with either read leg (SQ-1026: `WrongChainError` is raised
// inside `getSmProvider`'s chain factory, which PAPI retries indefinitely, so the terminal
// refusal never reaches the caller). Zombienet stops at the first failing assertion, so a
// refusal leg placed ahead of the read legs would make every later leg unreachable — the
// results of legs that do pass would be hidden by a defect they do not share.
//
// The third leg is not a formality. `boot` alone proves that a boot happened; the
// identity check is what stops every downstream read being honestly verified against
// the wrong chain, and a run in which it never fires witnesses nothing about it.
//
// Neither is the fourth. `openWithdrawLeg`/`openDepositLeg` had no production caller and no
// live caller, so the two 02 §7.7 Asset Hub reads, the two local reads and the four keys behind
// them had never been built from real metadata and answered by a real chain.
//
// ## Why this shells out
//
// The helper runs under the pinned Zombienet binary's own Node, which has no resolution
// root for `@bleavit/*` and loads CommonJS. The client is ESM, resolves through pnpm's
// isolated `node_modules`, and its packages export `dist/`. So the boundary is a process
// boundary, and it is drawn where the two module systems already stop — this file gathers
// chain facts through the `zombie` global and hands them to the app's own entry points.
//
// ## The specs come from the SPAWNED network, not from `zombienet/specs/out/`
//
// This is the correction the first real run forced, and it is not a detail. Zombienet
// rewrites the specs it is given before it boots them — it injects validator session keys
// into the relay genesis and registers the parachains — so the file the generator wrote and
// the chain zombienet is running have **different genesis hashes**. Pinning the generated
// spec while reading the genesis off a spawned node produces exactly the mismatch the
// identity check exists to catch, and the client refuses to boot (correctly).
//
// Zombienet writes its effective specs into the network directory, already **raw** and
// already carrying the spawned bootnodes: `<netdir>/paseo-local.json`,
// `<netdir>/<paraId>-paseo-local.json`. Those are the bytes the chain is actually running,
// so those are the bytes the pin must cover.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
// Every decision this file makes, with no I/O around it — see that module's header. It exists
// because both of this harness's shipped defects were decisions, and a decision that also
// performs its own I/O cannot be exercised before a release-tier drill run.
const rules = require("./client-boot-rules.js");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "target", "env");
const PIN_FILE = path.join(OUT, "client-boot-pin.json");
const ASSET_HUB_LIGHT = path.join(OUT, "client-boot-asset-hub-light.json");
const RELAY_NODE = "relay-alice";
const PARA_NODE = "bleavit-collator-1";
const ASSET_HUB_NODE = "asset-hub-collator-1";
const PARACHAIN_BINARY = path.join(ROOT, "zombienet", "bin", "polkadot-parachain");

/**
 * The three figures the funding leg cannot read from any chain — 02 §8; 11 §11.9.
 *
 * `amount` and the two fee estimates are a user's transaction intent; `min_balance` is a 02 §8
 * release pin whose normative home is 13. None of the four frozen surfaces carries any of them,
 * and `app/tools/drill-client/funding.ts` requires all four with no defaults for that reason —
 * so they are stated here, once, where a person reading the drill can see what the run assumed.
 * The report keeps them under `driverInputs`, never beside the reads.
 */
const FUNDING_INPUTS = {
  // 1 USDC, in the 6-decimal base units 02 §8 pins.
  amount: "1000000",
  assetHubFee: "0",
  localFee: "0",
  // 10^4 = 1 cent — 02 §8's `min_balance`, normative value in 13.
  usdcMinBalance: "10000",
};

function spawnedSpecs(networkInfo) {
  const dir = rules.networkDir(networkInfo, process.env);
  return {
    relay: path.join(dir, "paseo-local.json"),
    para: path.join(dir, "4242-paseo-local.json"),
    assetHub: path.join(dir, "1000-paseo-local.json"),
  };
}

function requireRawSpec(role, file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${role}: ${file} does not exist. Run tools/env/generate-relay-specs.sh — it emits the ` +
        "raw form beside the plain one, and smoldot accepts raw specs only.",
    );
  }
  const spec = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!spec.genesis || typeof spec.genesis.raw !== "object") {
    throw new Error(`${role}: ${file} is not a raw spec; smoldot would report it as a chain that never finalises`);
  }
  return spec;
}

// `system_localListenAddresses` returns full multiaddrs INCLUDING the peer id, which is
// what smoldot needs to dial. A fixed p2p port would not supply one, and the generated
// specs carry `"bootNodes": []` — `startTopology` refuses to dial nothing, so these
// addresses are the whole reason a locally generated spec is bootable at all (10 §4.3).
async function listenAddresses(api, node) {
  const raw = await api.rpc.system.localListenAddresses();
  const addresses = raw.toJSON().filter((entry) => typeof entry === "string" && entry.includes("/p2p/"));
  if (addresses.length === 0) {
    throw new Error(`${node} reported no listen address carrying a peer id; smoldot cannot dial it`);
  }
  // Prefer a loopback address: the node also advertises LAN addresses this process has no
  // reason to use, and a dial that goes out to the network first is slower for no gain.
  const local = addresses.filter((entry) => entry.includes("/ip4/127.0.0.1/"));
  return local.length > 0 ? local : addresses;
}

async function chainFacts(networkInfo, nodeName) {
  const node = networkInfo.nodesByName[nodeName];
  if (!node) throw new Error(`the topology has no node named ${nodeName}`);
  const api = await zombie.connect(node.wsUri, node.userDefinedTypes);
  try {
    const genesis = await api.rpc.chain.getBlockHash(0);
    return { genesisHash: genesis.toHex(), bootnodes: await listenAddresses(api, nodeName) };
  } finally {
    await api.disconnect();
  }
}

/**
 * An absolute path to a real Node that can run the client — never the bare name `node`.
 *
 * **`spawnSync("node", …)` does not reach the system Node from here, and the way it fails is
 * worse than not working.** Zombienet ships as a `pkg` single-file executable with Node
 * **18.5.0** embedded, and pkg's prelude re-points a spawn of the bare name at that binary. So
 * the child was Node 18: it does not strip TypeScript types (22.6 and later do) and it read
 * these files as CommonJS. The symptom is
 *
 *     SyntaxError: Cannot use import statement outside a module
 *
 * pointing at a correct `import` on line 64 of a correct file — which reads as a defect in
 * `dev-chain-pin.ts` and is nothing of the kind. Every frame below it named
 * `pkg/prelude/bootstrap.js`, and that is the only part of the message that identifies the
 * cause.
 *
 * The floor comes from `app/.nvmrc`, which is the same file `ci.yml` feeds to
 * `actions/setup-node`, so the drill cannot ask for a Node that CI does not install. Major
 * equality rather than *at least*, because `app/package.json` pins `engines.node` to
 * `">=22.19.0 <23"` — one band, deliberately closed at both ends.
 */
function systemNode() {
  const pinned = fs.readFileSync(path.join(ROOT, "app", ".nvmrc"), "utf8").trim();
  const tried = [];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, "node");
    if (!fs.existsSync(candidate)) continue;
    // `process.pkg` as well as the version. The version alone would stop telling an
    // interception from a genuine answer the day zombienet is repackaged on a Node in the
    // same major, and `process.pkg` is defined **only** inside a pkg binary — so it names the
    // thing being excluded rather than approximating it.
    //
    // Comparing execPath against `candidate` or against `process.execPath` were both tried and
    // are both wrong: a candidate is usually a symlink and Node resolves through it, and the
    // parent is legitimately the same Node whenever a person runs this helper outside
    // zombienet. Each test rejected the correct answer for a reason unrelated to pkg.
    const probe = spawnSync(candidate, ["-p", "[process.version, typeof process.pkg].join(' ')"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const answer = (probe.stdout ?? "").trim();
    const [version, packaged] = answer.split(" ");
    tried.push(`${candidate} -> ${answer || `no answer (status ${probe.status})`}`);
    if (probe.status !== 0 || version === undefined || packaged === undefined) continue;
    if (rules.admissibleNode(pinned, version, packaged)) return candidate;
  }

  throw new Error(
    `no Node on PATH satisfies app/.nvmrc (${pinned}) without being this binary in disguise. ` +
      `The bare name "node" is NOT a fallback here — zombienet is a pkg executable, pkg ` +
      `re-points that name at its own embedded Node 18, and Node 18 neither strips TypeScript ` +
      `types nor reads these files as ESM. Tried:\n  ${tried.join("\n  ")}`,
  );
}

/** Resolved once. The probe is three spawns of `node -p`, and `run` is called three times. */
let resolvedNode;
function clientNode() {
  if (resolvedNode === undefined) resolvedNode = systemNode();
  return resolvedNode;
}

function run(label, argv, timeoutSeconds) {
  const result = spawnSync(clientNode(), argv, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * The Asset Hub genesis **header**, built from the spawned spec's own bytes — F18.
 *
 * `export-genesis-head` reads the raw spec, builds the genesis trie and prints the header the
 * chain started from. Two things make this the right source rather than the convenient one:
 *
 *  - It is **offline and derived from the file**, not read from the running node. The pin's
 *    genesis hash is read from the node, and smoldot recomputes its own from the state root in
 *    the spec — so `assertGenesisIdentity` still compares two independent derivations. Taking
 *    the state root from `chain_getHeader(0)` instead would make both sides one reading of one
 *    source, which is the defect this harness already refuses in the other direction by never
 *    taking the pin from smoldot.
 *  - It is the **same binary** that runs the chain, so a spec it cannot build a genesis for is
 *    a spec no collator could have booted.
 *
 * Measured on this topology: 4.1 s here, against 23.6 s of uninterrupted smoldot CPU per
 * `addChain` of the untrimmed 79.4 MB spec — and the deposit path adds a **second** chain
 * handle for 10 §5.2's probe, so the cost was paid twice.
 */
function assetHubGenesisHead(specFile) {
  const probe = spawnSync(PARACHAIN_BINARY, ["export-genesis-head", "--chain", specFile], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (probe.error) throw new Error(`export-genesis-head: ${probe.error.message}`);
  if (probe.status !== 0) {
    throw new Error(`export-genesis-head exited ${probe.status}\n--- stderr ---\n${probe.stderr}`);
  }
  const header = (probe.stdout ?? "").trim();
  if (!rules.looksLikeGenesisHeader(header)) {
    throw new Error(
      `export-genesis-head did not print a genesis header (zero parent, block 0): ${header.slice(0, 120)}`,
    );
  }
  return header;
}

async function buildPin(networkInfo) {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const RAW = spawnedSpecs(networkInfo);
  fs.writeFileSync(path.join(OUT, "client-boot-specs.json"), JSON.stringify(RAW, null, 2), { mode: 0o600 });
  for (const [role, file] of Object.entries(RAW)) requireRawSpec(role, file);
  const relay = await chainFacts(networkInfo, RELAY_NODE);
  const para = await chainFacts(networkInfo, PARA_NODE);
  const assetHub = await chainFacts(networkInfo, ASSET_HUB_NODE);
  const assetHubHead = assetHubGenesisHead(RAW.assetHub);

  // The genesis hashes come from the NODES, never from smoldot's own
  // `chainSpec_v1_genesisHash`. That value is what `assertGenesisIdentity` compares
  // against, so deriving the pin from it would compare a reading with itself and pass
  // for any chain at all — including the corrupted-pin leg below.
  //
  // `--asset-hub-genesis-head` / `--asset-hub-light-out` trim the Asset Hub genesis to the
  // state root it hashes to and pin **that** file. The genesis hash smoldot computes is
  // unchanged — verified against this pair before the flags were added — and the chain the pin
  // describes is still the chain the node is running, because that half comes from the node.
  run(
    "dev-chain-pin",
    [
      "app/tools/dev-chain-pin.ts",
      "--relay", RAW.relay, "--relay-genesis", relay.genesisHash,
      "--para", RAW.para, "--para-genesis", para.genesisHash,
      "--asset-hub", RAW.assetHub, "--asset-hub-genesis", assetHub.genesisHash,
      "--asset-hub-genesis-head", assetHubHead,
      "--asset-hub-light-out", ASSET_HUB_LIGHT,
      "--out", PIN_FILE,
    ],
    600,
  );

  fs.writeFileSync(
    path.join(OUT, "client-boot-bootnodes.json"),
    JSON.stringify({ relay: relay.bootnodes, para: para.bootnodes, assetHub: assetHub.bootnodes }, null, 2),
    { mode: 0o600 },
  );
  return 1;
}

function reportPath(mode) {
  return path.join(OUT, `client-boot-report-${mode}.json`);
}

function bootnodeArgs() {
  const bootnodes = JSON.parse(fs.readFileSync(path.join(OUT, "client-boot-bootnodes.json"), "utf8"));
  return [
    "--relay-bootnodes", bootnodes.relay.join(","),
    "--para-bootnodes", bootnodes.para.join(","),
    "--asset-hub-bootnodes", bootnodes.assetHub.join(","),
  ];
}

function bootArgs(mode) {
  if (mode === "funding") {
    return [
      "app/tools/drill-client/funding.ts",
      "--pin", PIN_FILE,
      ...bootnodeArgs(),
      "--amount", FUNDING_INPUTS.amount,
      "--asset-hub-fee", FUNDING_INPUTS.assetHubFee,
      "--local-fee", FUNDING_INPUTS.localFee,
      "--usdc-min-balance", FUNDING_INPUTS.usdcMinBalance,
      "--timeout-seconds", "300",
      "--report", reportPath(mode),
    ];
  }
  return [
    "app/tools/drill-client/boot.ts",
    "--pin", PIN_FILE,
    ...bootnodeArgs(),
    "--mode", mode,
    "--timeout-seconds", "300",
    "--report", reportPath(mode),
  ];
}

/**
 * Run a leg and read its report from the file the leg wrote — **not** from its stdout.
 *
 * Parsing stdout worked for exactly as long as nothing else in the process wrote to it.
 * smoldot logs from a worker thread whose `console` is that same stdout, so the boot leg
 * failed with `Unexpected token s in JSON at position 1` after a 348-second run that had
 * actually succeeded. A JSON error is a bad way to be told that a library logged something.
 *
 * The previous report is deleted first, so a leg that produces none fails as *missing*
 * rather than passing on the last run's answer — which, on a drill whose whole subject is
 * a check that stopped checking, is the mistake most worth not making.
 */
function reportOf(label, mode, timeoutSeconds) {
  const file = reportPath(mode);
  fs.rmSync(file, { force: true });
  const stdout = run(label, bootArgs(mode), timeoutSeconds);
  if (!fs.existsSync(file)) throw rules.missingReportError(label, file, stdout);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function boot() {
  const report = rules.assertBootReport(reportOf("client boot", "boot", 840));
  console.log(`client boot: ${JSON.stringify(report)}`);
  return 1;
}

async function wrongChain() {
  const report = rules.assertWrongChainReport(reportOf("wrong-chain refusal", "wrong-chain", 540));
  console.log(`wrong-chain refused: expected ${report.expected}, observed ${report.observed}`);
  return 1;
}

/**
 * The 11 §11.9 funding read path, against both live chains — F18.
 *
 * **Two different claims, and this leg reports both.** Whether the run *failed* is the tier's
 * question: at the release tier the deposit leg must be `ready` and must show the three things 15
 * §4.8 says this row certifies, while at the exploratory tier the two documented environmental
 * refusals stay legitimate outcomes. Whether the run *certified* is a separate line, printed at
 * either tier — because a drill whose only output is pass/fail cannot tell a run that walked the
 * deposit path from one that refused before opening a reader, and that is precisely how this leg
 * went green three times over having proved less each time than it claimed.
 *
 * The tier comes from `BLEAVIT_DRILL_TIER` and defaults to `release`, so the fail-closed
 * direction is the default and the escape has to be typed by a person.
 */
async function funding() {
  const tier = rules.drillTier(process.env);
  const report = rules.assertFundingReport(reportOf("funding read path", "funding", 900), tier);
  const certification = rules.fundingCertification(report);
  console.log(`funding tier: ${tier}`);
  console.log(`funding certification: ${certification.summary}`);
  console.log(`funding withdraw: ${JSON.stringify(report.withdraw)}`);
  console.log(`funding deposit: ${JSON.stringify(report.deposit)}`);
  console.log(`funding inputs: ${JSON.stringify(report.driverInputs)}`);
  return 1;
}

async function run_(nodeName, networkInfo, args) {
  const leg = String(args[0] ?? "").trim();
  if (leg === "pin") return buildPin(networkInfo);
  if (leg === "boot") return boot();
  if (leg === "wrong-chain") return wrongChain();
  if (leg === "funding") return funding();
  throw new Error(`unknown leg ${JSON.stringify(leg)}; expected pin, boot, wrong-chain or funding`);
}

module.exports = { run: run_ };
