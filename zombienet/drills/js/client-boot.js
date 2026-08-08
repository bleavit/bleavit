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
// ## The specs handed to smoldot are the RAW ones, and the ones zombienet spawned are not
//
// The pinned zombienet schedules a parachain only from a PLAIN spec; smoldot accepts raw
// specs only and `chain-spec.ts` refuses anything else. `generate-relay-specs.sh` emits
// both forms from one generation for that reason (F27). Using the plain spec here fails
// inside `addChain` as a chain that never finalises, which is indistinguishable from slow
// sync — so the raw path is asserted before anything is started.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "target", "env");
const PIN_FILE = path.join(OUT, "client-boot-pin.json");
const SPECS = path.join(ROOT, "zombienet", "specs", "out");

const RELAY_NODE = "relay-alice";
const PARA_NODE = "bleavit-collator-1";
const ASSET_HUB_NODE = "asset-hub-collator-1";

const RAW = {
  relay: path.join(SPECS, "paseo-local-raw.json"),
  para: path.join(SPECS, "bleavit-drill-raw.json"),
  assetHub: path.join(SPECS, "asset-hub-paseo-local-raw.json"),
};

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

function run(label, argv, timeoutSeconds) {
  const result = spawnSync("node", argv, {
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
  for (const [role, file] of Object.entries(RAW)) requireRawSpec(role, file);
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });

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
  ];
}

async function boot() {
  const report = JSON.parse(run("client boot", bootArgs("boot"), 540));
  // `unestablished` is what the classifier returns when no chain was connected, so a
  // report carrying it is a boot that did not happen wearing a verdict's clothes.
  if (report.compat === "unestablished") {
    throw new Error(`the classifier ran without a chain: ${JSON.stringify(report)}`);
  }
  if (typeof report.finalizedHash !== "string" || !report.finalizedHash.startsWith("0x")) {
    throw new Error(`no finalized head was delivered: ${JSON.stringify(report)}`);
  }
  console.log(`client boot: ${JSON.stringify(report)}`);
  return 1;
}

async function wrongChain() {
  const report = JSON.parse(run("wrong-chain refusal", bootArgs("wrong-chain"), 540));
  if (report.refused !== true || report.code !== "FE-BOOT-003") {
    throw new Error(`the corrupted pin was not refused as FE-BOOT-003: ${JSON.stringify(report)}`);
  }
  if (report.expected === report.observed) {
    throw new Error(
      `the refusal compared a value with itself (${report.expected}); the corrupted pin never ` +
        "reached the identity check, so this leg witnesses nothing",
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
