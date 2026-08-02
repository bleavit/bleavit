// N10 / 16 §12 — I-36 under an absent return HRMP channel.
//
// The drill has TWO legs and selects between them by reading the chain, because
// which one is reachable is a property of the values layer rather than of the
// harness:
//
//   * `armed` (clients admitted) — the full lifecycle. Register, bond, open,
//     observe, seal, then check the authoritative report on Bleavit. The
//     no-return topology must leave the client-side report absent while
//     preserving Bleavit's Welfare.XcmTraffic cell: the optional push leg may
//     fail, but it cannot become XCM-health input.
//   * `inert` (no client admitted) — the containment leg, which is what a
//     release-shaped chain can actually witness today, and it is a real
//     assertion rather than a skip. See below.
//
// WHY THE LIFECYCLE IS NOT REACHABLE ON A RELEASE-SHAPED CHAIN (measured
// 2026-08-02, and the reason this file grew a second leg). The hosted service is
// deliberately inert until the values layer arms it, and admission is gated
// twice over:
//
//   1. `svc.client_bond` is `[VERIFY]`-tagged and ABSENT from the registry, so
//      `client_registry.admit_client` refuses `ClientBondUnset` before any hold
//      or registry write. 13 §1 states the row stays unset "until
//      registration-abuse calibration can derive it" — seeding it to green a
//      drill would be exactly the fabricated value R-2 forbids.
//   2. `admit_client` requires `EnsureGuardianTrack`, which accepts only a
//      Guardian-track referendum origin — no Root arm, so sudo cannot forge it —
//      and `pallet-client-registry` has no `GenesisConfig`, so no drill-reachable
//      admission path exists at all.
//
// Run against that chain the lifecycle fails at `register` with
// `polkadotXcm.ProcessXcmError` and `messageQueue.Processed { success: false }`:
// the program crosses, Bleavit's barrier ACCEPTS it (so the six-position
// template round-trips), and execution then fails closed at the admission gate.
//
// WHAT THE CONTAINMENT LEG PROVES, AND WHAT IT DOES NOT. It proves the
// containment half of I-36 — external ingress and its refusal move no
// `Welfare.XcmTraffic` byte, so a hostile or broken client cannot drag Bleavit's
// XCM-health input by sending to it. It does NOT prove the push-failure half:
// with no report there is no outbound push, so the "failed delivery must not
// feed X" path is unwitnessed. That gap is recorded in the artifact under
// `i36_push_leg_unwitnessed` rather than hidden behind a green tick, and the leg
// upgrades itself automatically — the moment a client is admitted, the same
// entry point runs the full lifecycle instead.
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.cwd(), "target", "env", "client-return-channel-absent.json");
const CLIENT_NODE = "client-collator-1";
const BLEAVIT_NODE = "bleavit-collator-1";

function json(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function number(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value?.toString?.() ?? value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`non-integer codec value '${value}'`);
  return parsed;
}

function eventOf(events, section, method) {
  return events.find(({ event }) => event.section === section && event.method === method)?.event;
}

function writeState(value) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function connect(networkInfo, nodeName) {
  const node = networkInfo.nodesByName[nodeName];
  if (!node) throw new Error(`topology has no node '${nodeName}'`);
  return zombie.connect(node.wsUri, node.userDefinedTypes);
}

function submit(call, signer) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (callback) => {
      settled = true;
      if (unsubscribe) unsubscribe();
      callback();
    };
    call.signAndSend(signer, ({ dispatchError, events, status }) => {
      if (dispatchError) finish(() => reject(new Error(dispatchError.toString())));
      else if (status.isInBlock) finish(() => resolve(events));
    }).then((unsub) => {
      unsubscribe = unsub;
      if (settled) unsubscribe();
    }).catch((error) => finish(() => reject(error)));
  });
}

async function blockEvents(api, numberAt) {
  const hash = await api.rpc.chain.getBlockHash(numberAt);
  return (await api.at(hash)).query.system.events();
}

// Correlation is by QUEUE ORIGIN plus position, never by message id — the same
// correction drill 13 needed, for the same two reasons.
//
//   1. `bleavitClient.IngressSent`'s id is the XCM message id; the `id` in the
//      receiver's `messageQueue` events is the queue's own hash of the enqueued
//      message. They are different quantities, so an id match cannot fire and
//      every outcome — success, refusal, never-arrived — collapsed into the same
//      900-second timeout.
//   2. Taking the first queue event in range instead is also wrong: the
//      post-genesis HRMP open (SQ-567) makes the relay send channel
//      notifications over DMP, and those are `Processed { success: true }`.
//
// Both events carry the `AggregateMessageOrigin` second: the client's programs
// arrive as `Sibling(CLIENT_PARA)`, relay notifications as `Parent`. Position
// disambiguates within that origin because each leg awaits its receipt before
// sending the next.
//
// A failure names the STAGE and dumps the block's events, so an unmet
// precondition (an unadmitted client, an unfunded escrow, a closed gate) is
// diagnosable from the drill log alone instead of requiring a live chain.
const CLIENT_PARA = 4343;

function isFromClient(event) {
  const origin = event.data[1];
  return origin?.isSibling === true && origin.asSibling.toNumber() === CLIENT_PARA;
}

// Returns the receipt WITHOUT judging it, so both legs can share one waiter:
// the lifecycle demands success, the containment leg demands refusal, and
// neither can accidentally accept the other's outcome.
async function awaitReceipt(api, label, start) {
  const deadline = Date.now() + 300_000;
  let next = start;
  const seen = [];
  while (Date.now() < deadline) {
    const head = number((await api.rpc.chain.getHeader()).number);
    while (next <= head) {
      const events = await blockEvents(api, next);
      const list = events.map(({ event }) => event);
      for (const event of list) {
        if (event.section !== "messageQueue") continue;
        seen.push(`${event.method}(${event.data[1]?.toString?.()})@${next}`);
        if (!isFromClient(event)) continue;
        if (event.method === "ProcessingFailed") {
          return {
            block: next,
            events,
            receipt: "ProcessingFailed",
            executed: false,
            detail: event.data[2]?.toString?.() ?? "unknown error",
          };
        }
        if (event.method === "Processed") {
          const succeeded = event.data[event.data.length - 1]?.isTrue === true;
          return {
            block: next,
            events,
            receipt: succeeded ? "Processed(success=true)" : "Processed(success=false)",
            executed: succeeded,
            detail: list.map((one) => `${one.section}.${one.method}`).join(", "),
          };
        }
      }
      next += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(
    `${label}: no messageQueue receipt from Sibling(${CLIENT_PARA}) in blocks ${start}..${next}; `
      + `messageQueue events seen: ${seen.length ? seen.join(", ") : "NONE"}`,
  );
}

async function waitForProcessed(api, label, start) {
  const result = await awaitReceipt(api, label, start);
  if (!result.executed) {
    throw new Error(
      `${label}: ${result.receipt} at #${result.block}; ${result.detail}`,
    );
  }
  return result;
}

async function waitForBlock(api, target) {
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    const head = number((await api.rpc.chain.getHeader()).number);
    if (head >= target) return head;
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`chain did not reach block ${target}`);
}

async function readQuestion(api, questionId) {
  const questions = api.query.questionService?.questions;
  if (!questions) throw new Error("QuestionService.Questions is absent from metadata");
  const value = await questions(questionId);
  if (value.isNone) throw new Error(`QuestionService.Questions[${questionId}] is absent`);
  const row = value.unwrap();
  return {
    windowStart: number(row.windowStart),
    windowEnd: number(row.windowEnd),
    markets: row.markets.map(number),
  };
}

async function trafficCell(api, epoch, day) {
  const traffic = api.query.welfare?.xcmTraffic;
  if (!traffic) throw new Error("Welfare.XcmTraffic is absent from metadata");
  return json(await traffic(epoch, day));
}

async function health(api) {
  const epochOf = api.query.epoch?.epochOf;
  if (!epochOf) throw new Error("Epoch.epochOf is absent from metadata");
  const epoch = number(json(await epochOf()).index);
  const day = 0;
  return { epoch, day, value: await trafficCell(api, epoch, day) };
}

async function waitForReport(api, questionId) {
  const reports = api.query.questionService?.reports;
  if (!reports) throw new Error("QuestionService.Reports is absent from metadata");
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    const report = await reports(questionId);
    if (report.isSome) return json(report.unwrap());
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`QuestionService.Reports[${questionId}] was not published after seal`);
}

function messageId(events) {
  const sent = eventOf(events, "bleavitClient", "IngressSent");
  if (!sent) throw new Error("client lifecycle call did not emit bleavitClient.IngressSent");
  return sent.data[sent.data.length - 1].toHex();
}

function governance(api, call) {
  const sudo = api.tx.sudo?.sudo;
  if (!sudo) throw new Error("reference client runtime has no governance sudo path");
  return sudo(call);
}

// How many clients the registry has admitted. This — not a harness flag — is
// what decides which leg runs, so the drill cannot claim a lifecycle it never
// reached and cannot keep asserting containment once the service is armed.
async function admittedClients(api) {
  const count = api.query.clientRegistry?.clientCount;
  if (!count) throw new Error("ClientRegistry.ClientCount is absent from metadata");
  return number(await count());
}

async function prepare(networkInfo) {
  await zombie.util.cryptoWaitReady();
  const client = await connect(networkInfo, CLIENT_NODE);
  const bleavit = await connect(networkInfo, BLEAVIT_NODE);
  const clientKeys = new zombie.Keyring({ type: "sr25519", ss58Format: client.registry.chainSS58 });
  const bleavitKeys = new zombie.Keyring({ type: "sr25519", ss58Format: bleavit.registry.chainSS58 });
  const alice = clientKeys.addFromUri("//Alice");
  const bob = bleavitKeys.addFromUri("//Bob");
  const charlie = bleavitKeys.addFromUri("//Charlie");
  const dave = bleavitKeys.addFromUri("//Dave");

  const ask = client.tx.bleavitClient?.ask;
  const open = client.tx.bleavitClient?.open;
  const seal = client.tx.bleavitClient?.seal;
  if (!ask || !open || !seal) throw new Error("client lifecycle call surface is incomplete");
  const question = {
    subId: null,
    declaredStake: 100_000_000_000n,
    epsilon1e9: 50_000_000,
    tolerance1e9: 20_000_000,
    // 40 blocks is the smallest useful drill window for the release
    // mkt.obs_interval=10 fixture while remaining below svc.max_window.
    window: 40,
    attestors: [bob.publicKey, charlie.publicKey, dave.publicKey],
    rule: { minAcceptImprovement1e9: 10_000_000 },
  };
  return {
    client,
    bleavit,
    alice,
    attestors: [bob, charlie, dave],
    ask,
    open,
    seal,
    question,
    before: await health(bleavit),
  };
}

const CONTROL_BLOCKS = 10;
const SETTLE_BLOCKS = 4;

function counters(cell) {
  return {
    accepted: Number(cell?.accepted ?? 0),
    failed: Number(cell?.failed ?? 0),
    probeTimeouts: Number(cell?.probeTimeouts ?? cell?.probe_timeouts ?? 0),
  };
}

function delta(from, to) {
  return {
    accepted: to.accepted - from.accepted,
    failed: to.failed - from.failed,
    probeTimeouts: to.probeTimeouts - from.probeTimeouts,
  };
}

// Every `polkadotXcm.Sent` in [from, to] whose destination names the client
// para. Matching on the rendered destination rather than on a typed walk is
// deliberate: `Sent.destination` is an UNVERSIONED `Location` here (the same
// fact drill 07's v5 assertion got wrong), its shape varies with the junction
// count, and this only has to answer "does this send point at 4343".
async function sendsToClient(api, from, to) {
  const hits = [];
  for (let at = from; at <= to; at += 1) {
    const events = await blockEvents(api, at);
    for (const { event } of events) {
      if (event.section !== "polkadotXcm" || event.method !== "Sent") continue;
      const destination = event.data[1]?.toString?.() ?? "";
      if (destination.includes(String(CLIENT_PARA))) {
        hits.push(`#${at} -> ${destination}`);
      }
    }
  }
  return hits;
}

// I-36, containment half, on an inert release-shaped chain: a real ingress
// crosses the one-way channel, Bleavit refuses it fail-closed, nothing is pushed
// back, and — the load-bearing clause — the refusal causes no outbound send.
//
// This is a CONTROLLED measurement, and the first version of it was not, which
// is why it failed for the wrong reason. Asserting the cell byte-identical
// across the ingress window is over-strong: Bleavit performs its own outbound
// XCM on this chain, so the cell moves on its own and a test that fails for
// something outside its own claim is broken rather than strict.
//
// MEASURED (2026-08-02): a quiet 10-block control window moved `accepted` by
// **+2** with `failed` and `probe_timeouts` flat, while the refused-ingress
// window moved **nothing at all** — 0/0/0. Worth recording that the obvious
// guess was wrong: the background was Bleavit's own accepted sends around the
// channel handshake, NOT the 07 §8 reserve probe timing out, so a diagnosis
// written from the hypothesis instead of the measurement would have been
// confidently wrong. The control also proves the counters were live at the time,
// which is what stops a zero treatment from being a dead-instrument artifact.
//
// Two independent checks are therefore made, one statistical and one direct:
//
//   * the SEND terms of `X` (`accepted`, `failed`) must not move across the
//     ingress window, judged against that quiet control. `probe_timeouts` is
//     internally triggered rather than externally and is excluded deliberately;
//     the control measures it, so the exclusion is visible in the artifact
//     rather than assumed silently.
//   * no `polkadotXcm.Sent` in the ingress window may name the CLIENT para.
//     This one ATTRIBUTES instead of inferring — it is immune to unrelated
//     background traffic, and it targets I-36's actual hazard, which is a send
//     toward a client whose return channel is absent and would therefore fail.
async function containment(context) {
  const { client, bleavit, alice, ask, question, before } = context;
  const { epoch, day } = before;

  const controlStart = number((await bleavit.rpc.chain.getHeader()).number);
  await waitForBlock(bleavit, controlStart + CONTROL_BLOCKS);
  const control = counters(await trafficCell(bleavit, epoch, day));
  const background = delta(counters(before.value), control);

  const start = number((await bleavit.rpc.chain.getHeader()).number);
  const events = await submit(governance(client, ask(question)), alice);
  const sentMessage = messageId(events);
  const receipt = await awaitReceipt(bleavit, "register", start);
  if (receipt.executed) {
    throw new Error(
      `register executed at #${receipt.block} on a chain with no admitted client; `
        + "the service is not fail-closed",
    );
  }
  // Give any send the refusal might have triggered time to land before
  // measuring; a same-block read would exonerate a delayed one.
  const settleAt = receipt.block + SETTLE_BLOCKS;
  await waitForBlock(bleavit, settleAt);
  const treated = counters(await trafficCell(bleavit, epoch, day));
  const treatment = delta(control, treated);
  const sentToClient = await sendsToClient(bleavit, start, settleAt);

  // No question exists, so nothing could have been pushed; assert it anyway,
  // because the absent return channel is the point of this topology.
  const localReports = client.query.bleavitClient?.reports;
  if (localReports && (await localReports(0)).isSome) {
    throw new Error("a client report exists although no question was ever registered");
  }
  if (sentToClient.length > 0) {
    throw new Error(
      `I-36: processing a refused client ingress made Bleavit SEND to the client — `
        + `${sentToClient.join("; ")}. On a topology with no return channel that send `
        + "fails, and a failed send is an input to X",
    );
  }
  if (treatment.accepted !== 0 || treatment.failed !== 0) {
    throw new Error(
      `I-36: a refused client ingress moved the SEND terms of `
        + `Welfare.XcmTraffic[${epoch},${day}] — accepted +${treatment.accepted}, `
        + `failed +${treatment.failed} over blocks ${start}..${receipt.block + SETTLE_BLOCKS}; `
        + `quiet control window of ${CONTROL_BLOCKS} blocks moved accepted `
        + `+${background.accepted}, failed +${background.failed}, `
        + `probe_timeouts +${background.probeTimeouts}`,
    );
  }
  writeState({
    leg: "containment",
    armed: false,
    reason: "no client admitted: svc.client_bond is [VERIFY]-unset and admit_client "
      + "requires the Guardian track, so the hosted service is inert by design",
    sentMessage,
    refusedAtBlock: receipt.block,
    receipt: receipt.receipt,
    detail: receipt.detail,
    noReturnChannel: true,
    epoch,
    day,
    controlWindowBlocks: CONTROL_BLOCKS,
    background,
    treatment,
    sendTermsUnchanged: true,
    sendsToClientPara: sentToClient.length,
    i36_push_leg_unwitnessed:
      "no report is produced, so the failed-delivery-must-not-feed-X path is not exercised",
    before: counters(before.value),
    control,
    after: treated,
  });
}

async function lifecycle(context) {
  const { client, bleavit, alice, attestors, ask, open, seal, question, before } = context;

  const registerStart = number((await bleavit.rpc.chain.getHeader()).number);
  const registerEvents = await submit(governance(client, ask(question)), alice);
  const registerMessage = messageId(registerEvents);
  const registered = await waitForProcessed(bleavit, "register", registerStart);
  const registeredEvent = eventOf(registered.events, "questionService", "QuestionRegistered");
  if (!registeredEvent) throw new Error("successful register has no QuestionRegistered event");
  const questionId = number(registeredEvent.data[0]);
  const record = await readQuestion(bleavit, questionId);

  const bond = bleavit.tx.questionService?.bondAttestor;
  if (!bond) throw new Error("QuestionService.bondAttestor is absent from metadata");
  for (const attestor of attestors) {
    await submit(bond(questionId), attestor);
  }

  await waitForBlock(bleavit, record.windowStart);
  const openStart = number((await bleavit.rpc.chain.getHeader()).number);
  const openEvents = await submit(governance(client, open(questionId)), alice);
  const openMessage = messageId(openEvents);
  await waitForProcessed(bleavit, "open", openStart);

  // Keep the books observed until just before the close. The final seal call
  // supplies the immutable end checkpoint; this is enough to make the
  // lifecycle reach report publication without adding an unrelated trade.
  await waitForBlock(bleavit, record.windowEnd - 2);
  const crank = bleavit.tx.market?.crankObserve;
  if (!crank) throw new Error("Market.crankObserve is absent from metadata");
  const observeCalls = record.markets.map((market) => crank(market));
  const batchAll = bleavit.tx.utility?.batchAll;
  if (batchAll) await submit(batchAll(observeCalls), alice);
  else for (const call of observeCalls) await submit(call, alice);

  await waitForBlock(bleavit, record.windowEnd);
  const sealStart = number((await bleavit.rpc.chain.getHeader()).number);
  const sealEvents = await submit(governance(client, seal(questionId)), alice);
  const sealMessage = messageId(sealEvents);
  const sealed = await waitForProcessed(bleavit, "seal", sealStart);
  const sealedEvent = eventOf(sealed.events, "questionService", "QuestionSealed");
  if (!sealedEvent) throw new Error("successful seal has no QuestionSealed event");
  const report = await waitForReport(bleavit, questionId);

  // The no-return topology is the assertion: publication succeeds, but the
  // optional report cannot arrive in the client runtime. Its failure must not
  // be represented as a local Welfare.XcmTraffic failure or success.
  const localReports = client.query.bleavitClient?.reports;
  if (localReports && (await localReports(questionId)).isSome) {
    throw new Error("report unexpectedly crossed an absent return HRMP channel");
  }
  const after = {
    ...before,
    value: await trafficCell(bleavit, before.epoch, before.day),
  };
  if (JSON.stringify(before.value) !== JSON.stringify(after.value)) {
    throw new Error(`report egress changed Welfare.XcmTraffic[${before.epoch},${before.day}]`);
  }
  writeState({
    leg: "lifecycle",
    armed: true,
    questionId,
    registerMessage,
    openMessage,
    sealMessage,
    reportPublished: report !== null,
    noReturnChannel: true,
    xcmHealthUnchanged: true,
    before,
    after,
  });
}

async function run(_nodeName, networkInfo, args) {
  if (args[0] !== "lifecycle") throw new Error(`unknown client return-channel leg '${args[0]}'`);
  const context = await prepare(networkInfo);
  const clients = await admittedClients(context.bleavit);
  return clients === 0 ? containment(context) : lifecycle(context);
}

module.exports = { run };
