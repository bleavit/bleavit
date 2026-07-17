// 15 §4.7; 09 §7.1; 13 §2 — measure dead-man time in relay blocks.
async function run(_nodeName, networkInfo, args) {
  const relay = networkInfo.nodesByName["relay-alice"];
  if (!relay) throw new Error("relay-alice is absent from the drill topology");
  const api = await zombie.connect(relay.wsUri, relay.userDefinedTypes);
  const requiredGap = Number(args[0] || 4_800);
  // With 2 of 4 relay authorities paused, ~half the slots go unauthored
  // (~12 s/block), so 4,800 best-over-finalized blocks need ≈57,600 s.
  const deadline = Date.now() + 90_000_000;

  while (Date.now() < deadline) {
    const finalizedHash = await api.rpc.chain.getFinalizedHead();
    const finalized = (await api.rpc.chain.getHeader(finalizedHash)).number.toNumber();
    const best = (await api.rpc.chain.getHeader()).number.toNumber();
    if (best - finalized >= requiredGap) return { best, finalized, gap: best - finalized };
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`relay finalized-head stall never reached ${requiredGap} blocks`);
}

module.exports = { run };
