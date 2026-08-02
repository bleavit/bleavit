// N10 / 16 §12 — finalized-header report pull and I-36 containment check.
//
// The release-shaped drill deliberately leaves the governed service rate
// unset, so the preceding quickstart leg produces no report. The pull still
// exercises the client read path: it obtains the raw Reports[0] key, reads it
// at a finalized hash, asks the node for the corresponding trie proof, and
// records the absent value without treating absence as a valid report. The
// same XcmTraffic cell is read before and after the pull and must be
// byte-identical. A non-empty report is verified by the TS kit, not by this
// JS harness.
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.cwd(), "target", "env", "client-report-pull.json");
const NODE = "bleavit-collator-1";

function json(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function stable(value) {
  return JSON.stringify(value);
}

async function finalized(api) {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  return { hash: hash.toHex(), number: header.number.toNumber() };
}

async function reportProof(api, pin) {
  const reports = api.query.questionService?.reports;
  if (!reports?.key) throw new Error("QuestionService.Reports is absent from metadata");
  const key = reports.key(0);
  const value = await api.rpc.state.getStorage(key, pin.hash);
  const proof = await api.rpc.state.getReadProof([key], pin.hash);
  if (!proof?.proof || proof.proof.length === 0) {
    throw new Error("state_getReadProof returned no trie nodes for QuestionService.Reports[0]");
  }
  return {
    key,
    value: value?.toHex?.() ?? null,
    proofNodes: proof.proof.length,
  };
}

async function trafficAt(api, epoch, day) {
  const traffic = api.query.welfare?.xcmTraffic;
  if (!traffic) throw new Error("Welfare.XcmTraffic is absent from metadata");
  return json(await traffic(epoch, day));
}

function writeState(value) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function run(nodeName, networkInfo, args) {
  if (args[0] !== "pull") throw new Error(`unknown report-pull leg '${args[0]}'`);
  const node = networkInfo.nodesByName[nodeName || NODE];
  if (!node) throw new Error(`topology has no node '${nodeName || NODE}'`);
  const api = await zombie.connect(node.wsUri, node.userDefinedTypes);
  if (!api.query.epoch?.epochOf) throw new Error("Epoch.epochOf is absent from metadata");

  const beforePin = await finalized(api);
  const epoch = Number(json(await api.query.epoch.epochOf()).index);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error(`invalid epoch index ${epoch}`);
  const day = 0;
  const before = {
    pin: beforePin,
    proof: await reportProof(api, beforePin),
    traffic: await trafficAt(api, epoch, day),
  };

  // Let the chain finalize another head. No transaction is submitted by a
  // pull, so only the pin changes; the selected historical traffic cell does
  // not. This also catches a helper that accidentally sends or cranks state.
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const afterPin = await finalized(api);
  const after = {
    pin: afterPin,
    proof: await reportProof(api, afterPin),
    traffic: await trafficAt(api, epoch, day),
  };
  if (stable(before.traffic) !== stable(after.traffic)) {
    throw new Error(`report pull changed Welfare.XcmTraffic[${epoch},${day}]`);
  }
  if (before.proof.value !== null) {
    throw new Error("uncertified report appeared in the uncalibrated refusal drill");
  }
  writeState({ epoch, day, before, after, result: "proof-read-without-welfare-mutation" });
  return afterPin.number;
}

module.exports = { run };
