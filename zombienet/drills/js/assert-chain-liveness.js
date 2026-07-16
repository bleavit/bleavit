// 15 §4.7; 09 §7.1 — delta-based keeper/collator/dead-man liveness assertion.
const fs = require("fs");
const path = require("path");

function statePath(label, nodeName) {
  const safe = `${label}-${nodeName}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(process.cwd(), "target", "env", "zombienet-drill-state", `${safe}.json`);
}

async function run(nodeName, networkInfo, args) {
  const { wsUri, userDefinedTypes } = networkInfo.nodesByName[nodeName];
  const api = await zombie.connect(wsUri, userDefinedTypes);
  const values = args.length === 1 ? String(args[0]).split(",") : args;
  const mode = values[0];
  const label = values[1];
  if (!label) throw new Error("liveness helper requires a state label");
  const file = statePath(label, nodeName);

  if (mode === "capture") {
    const height = (await api.rpc.chain.getHeader()).number.toNumber();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ height })}\n`, { encoding: "utf8", mode: 0o600 });
    return height;
  }
  if (mode !== "assert") throw new Error(`unknown liveness mode '${mode}'`);
  if (!fs.existsSync(file)) throw new Error(`missing pre-fault height capture '${label}'`);
  const start = JSON.parse(fs.readFileSync(file, "utf8")).height;
  const requiredDelta = Number(values[2] || 2);
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const now = (await api.rpc.chain.getHeader()).number.toNumber();
    if (now >= start + requiredDelta) return now;
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`parachain advanced by fewer than ${requiredDelta} blocks`);
}

module.exports = { run };
