// 15 §4.7; 09 §7.1 — turn the B9 dependency into an explicit drill gate.
async function run(_nodeName, networkInfo) {
  if (!networkInfo.nodesByName.keeper) {
    throw new Error("keeper node absent — gated on B9");
  }
  return "keeper-present";
}

module.exports = { run };
