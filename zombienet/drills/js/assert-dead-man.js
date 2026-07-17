// 15 §4.7; 02 §7.3; 09 §1.2(10); 13 §2 — dead-man state assertion.
async function run(nodeName, networkInfo, args) {
  const { wsUri, userDefinedTypes } = networkInfo.nodesByName[nodeName];
  const api = await zombie.connect(wsUri, userDefinedTypes);
  const expected = args[0] || "engaged";
  const flags = (await api.query.constitution.phaseFlags()).toNumber();
  // Both engagement and post-recovery freeze-clear checks are A8/A11-gated.
  if (!api.query.epoch || !api.query.executionGuard) {
    throw new Error("NOTE(B7): A8/A11 runtime wiring is required for dead-man freeze assertions");
  }
  const deadMan = await api.query.epoch.deadMan();
  const queueFrozen = await api.query.executionGuard.deadManFreeze();
  const engaged = (flags & (1 << 6)) !== 0;
  if (expected === "engaged") {
    if (!engaged || deadMan.pausedAt.isNone || !queueFrozen.isTrue) {
      throw new Error("dead-man did not pause the epoch clock and execution queue");
    }
  } else if (expected === "cleared") {
    if (engaged || deadMan.pausedAt.isSome || queueFrozen.isTrue) {
      throw new Error("dead-man freeze did not clear after relay-finality recovery");
    }
  } else {
    throw new Error(`unknown dead-man assertion '${expected}'`);
  }
  return flags;
}

module.exports = { run };
