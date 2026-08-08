// F27 / 15 §4.8 — boot the canonical client's real light client against this topology.
//
// Three legs, run in order by `14-client-boot.zndsl`:
//
//   pin          read each chain's genesis hash and listen addresses, then build the
//                development pin with `app/tools/dev-chain-pin.ts`
//   boot         start smoldot, sync relay + parachain, classify both runtimes
//   wrong-chain  the same with one byte of the parachain genesis pin flipped, which
//                MUST be refused (10 §3.1 FE-BOOT-003, terminal, no override)
//
// The third leg is not a formality. `boot` alone proves that a boot happened; the
// identity check is what stops every downstream read being honestly verified against
// the wrong chain, and a run in which it never fires witnesses nothing about it.
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

const ROOT = process.cwd();
const OUT = path.join(ROOT, "target", "env");
const PIN_FILE = path.join(OUT, "client-boot-pin.json");
const RELAY_NODE = "relay-alice";
const PARA_NODE = "bleavit-collator-1";
const ASSET_HUB_NODE = "asset-hub-collator-1";

// Zombienet's `-d` directory, which the runner passes and which holds `zombie.json`.
// Resolved from the network spec rather than assumed, so a caller that moves it still works.
function networkDir(networkInfo) {
  const spec = networkInfo?.networkSpecPath ?? networkInfo?.tmpDir ?? process.env.ZOMBIE_DIR;
  if (typeof spec === "string" && spec.length > 0) {
    return spec.endsWith(".json") ? path.dirname(spec) : spec;
  }
  throw new Error(
    "cannot locate the spawned network directory; zombienet writes the effective chain specs " +
      "there and the generated specs in zombienet/specs/out/ are a DIFFERENT chain (see header)",
  );
}

function spawnedSpecs(networkInfo) {
  const dir = networkDir(networkInfo);
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
 * `">=22.18.0 <23"` — one band, deliberately closed at both ends.
 */
function systemNode() {
  const pinned = fs.readFileSync(path.join(ROOT, "app", ".nvmrc"), "utf8").trim();
  const floor = pinned.split(".").map((part) => Number.parseInt(part, 10));
  if (floor.length !== 3 || floor.some(Number.isNaN)) {
    throw new Error(`app/.nvmrc does not hold an x.y.z version: ${JSON.stringify(pinned)}`);
  }

  const admissible = (version) => {
    const got = version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
    if (got.length !== 3 || got.some(Number.isNaN) || got[0] !== floor[0]) return false;
    for (let i = 0; i < 3; i += 1) {
      if (got[i] !== floor[i]) return got[i] > floor[i];
    }
    return true;
  };

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
    if (probe.status !== 0 || version === undefined) continue;
    if (packaged !== "undefined") continue;
    if (admissible(version)) return candidate;
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

async function buildPin(networkInfo) {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const RAW = spawnedSpecs(networkInfo);
  fs.writeFileSync(path.join(OUT, "client-boot-specs.json"), JSON.stringify(RAW, null, 2), { mode: 0o600 });
  for (const [role, file] of Object.entries(RAW)) requireRawSpec(role, file);
  const relay = await chainFacts(networkInfo, RELAY_NODE);
  const para = await chainFacts(networkInfo, PARA_NODE);
  const assetHub = await chainFacts(networkInfo, ASSET_HUB_NODE);

  // The genesis hashes come from the NODES, never from smoldot's own
  // `chainSpec_v1_genesisHash`. That value is what `assertGenesisIdentity` compares
  // against, so deriving the pin from it would compare a reading with itself and pass
  // for any chain at all — including the corrupted-pin leg below.
  run(
    "dev-chain-pin",
    [
      "app/tools/dev-chain-pin.ts",
      "--relay", RAW.relay, "--relay-genesis", relay.genesisHash,
      "--para", RAW.para, "--para-genesis", para.genesisHash,
      "--asset-hub", RAW.assetHub, "--asset-hub-genesis", assetHub.genesisHash,
      "--out", PIN_FILE,
    ],
    120,
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

function bootArgs(mode) {
  const bootnodes = JSON.parse(fs.readFileSync(path.join(OUT, "client-boot-bootnodes.json"), "utf8"));
  return [
    "app/tools/drill-client/boot.ts",
    "--pin", PIN_FILE,
    "--relay-bootnodes", bootnodes.relay.join(","),
    "--para-bootnodes", bootnodes.para.join(","),
    "--asset-hub-bootnodes", bootnodes.assetHub.join(","),
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
  if (!fs.existsSync(file)) {
    throw new Error(`${label} exited 0 but wrote no report to ${file}\n--- stdout ---\n${stdout}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function boot() {
  const report = reportOf("client boot", "boot", 840);
  // `unestablished` is what the classifier returns when a probe could not complete, and
  // `not-attempted` when no chain was connected at all. A report carrying either is a boot
  // that did not happen wearing a verdict's clothes.
  if (report.compat === "unestablished" || report.compat === "not-attempted") {
    throw new Error(`the classifier ran without a chain: ${JSON.stringify(report)}`);
  }
  // **The lattice, not the wrapper.** `CompatVerdict.kind` says only whether a verdict was
  // reached, so asserting on it says only that a chain answered — which the finalized head
  // below already proves. 10 §5.2's verdict is the MODE, and a `read-only-incompatible`
  // runtime is `classified`: a leg that stopped at the wrapper would pass on the regression
  // it exists to catch.
  if (report.compatMode !== "full") {
    throw new Error(
      `10 §5.2 classified this runtime as ${JSON.stringify(report.compatMode)}, not "full". ` +
        `The drill spec is built from this repository's own runtime, so anything else means ` +
        `the frozen critical surface and the runtime disagree: ${JSON.stringify(report)}`,
    );
  }
  if (typeof report.finalizedHash !== "string" || !report.finalizedHash.startsWith("0x")) {
    throw new Error(`no finalized head was delivered: ${JSON.stringify(report)}`);
  }
  // **The same assertion one chain over, and it was missing until 2026-08-08.** The leg
  // recorded `ForeignVerdict.kind` and asserted nothing, so a `wrong-chain` Asset Hub, an
  // `unsupported` one and a `restricted` one all reported "classified" — the identical
  // wrapper-not-lattice defect the paragraph above describes, left standing beside its own
  // explanation. This drill is the only place 02 §7.7's classifier runs against a real chain.
  //
  // The Asset Hub leg is allowed to be absent: its genesis is ~189k entries and 11 E17 makes
  // the connection lazy and non-fatal. What is refused is a leg that ANSWERED and answered
  // wrongly — `classified` at any mode other than `full`, or a `classified` wrapper with no
  // mode behind it at all.
  if (report.assetHub === "classified" && report.assetHubMode !== "full") {
    throw new Error(
      `02 §7.7 classified Asset Hub as ${JSON.stringify(report.assetHubMode)}, not "full". ` +
        `A verdict was reached, so this is a real disagreement rather than an absent leg: ` +
        JSON.stringify(report),
    );
  }
  if (report.assetHub !== "classified" && report.assetHubMode !== undefined) {
    throw new Error(
      `Asset Hub reported a mode without a classified verdict, which no code path should ` +
        `produce: ${JSON.stringify(report)}`,
    );
  }
  console.log(`client boot: ${JSON.stringify(report)}`);
  return 1;
}

async function wrongChain() {
  const report = reportOf("wrong-chain refusal", "wrong-chain", 540);
  if (report.refused !== true || report.code !== "FE-BOOT-003") {
    throw new Error(`the corrupted pin was not refused as FE-BOOT-003: ${JSON.stringify(report)}`);
  }
  if (report.expected === report.observed) {
    throw new Error(
      `the refusal compared a value with itself (${report.expected}); the corrupted pin never ` +
        "reached the identity check, so this leg witnesses nothing",
    );
  }
  // The refusal must be about the PARACHAIN pin this leg corrupted. `startTopology` asserts
  // the relay first, so a stale relay pin also raises FE-BOOT-003 — and a leg that accepted
  // it would report the control witnessed while never reaching the byte it flipped. `boot.ts`
  // refuses that case; this is the second side of the same binding, kept here so the drill
  // cannot be satisfied by a harness that stopped making it.
  if (report.role !== "para" || report.observed !== report.uncorrupted) {
    throw new Error(
      `the refusal was not about the corrupted parachain pin: ${JSON.stringify(report)}`,
    );
  }
  console.log(`wrong-chain refused: expected ${report.expected}, observed ${report.observed}`);
  return 1;
}

async function run_(nodeName, networkInfo, args) {
  const leg = String(args[0] ?? "").trim();
  if (leg === "pin") return buildPin(networkInfo);
  if (leg === "boot") return boot();
  if (leg === "wrong-chain") return wrongChain();
  throw new Error(`unknown leg ${JSON.stringify(leg)}; expected pin, boot or wrong-chain`);
}

module.exports = { run: run_ };
