// 15 §4.7; 09 §7.1; 13 §1 — uncompressed epoch-progression assertion.
async function run(nodeName, networkInfo, args) {
  const { wsUri, userDefinedTypes } = networkInfo.nodesByName[nodeName];
  const api = await zombie.connect(wsUri, userDefinedTypes);
  if (!api.query.epoch?.epochOf) {
    throw new Error("NOTE(B7): A8 Epoch runtime wiring is required");
  }
  const minimum = Number(args[0]);
  const defaultEpochLength = 302_400;
  const expectedBlocks = minimum * defaultEpochLength;
  const height = (await api.rpc.chain.getHeader()).number.toNumber();
  if (height < expectedBlocks) {
    throw new Error(
      `Phase-1 soak reached only ${height} blocks; ${minimum} release-default epochs require ${expectedBlocks}`,
    );
  }
  const epoch = await api.query.epoch.epochOf();
  const index = epoch.index.toNumber();
  if (index < minimum) {
    throw new Error(`epoch index ${index} is below required ${minimum}`);
  }
  return index;
}

module.exports = { run };
