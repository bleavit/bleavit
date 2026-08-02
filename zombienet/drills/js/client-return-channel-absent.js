// N10 / 16 §12 — full client lifecycle with no return HRMP channel.
//
// This is deliberately a lifecycle drill, not another registration-refusal
// probe. It registers, bonds, opens, observes, seals, and then checks the
// authoritative report on Bleavit. The no-return topology must leave the
// client-side report absent while preserving Bleavit's Welfare.XcmTraffic
// cell: the optional push leg may fail, but it cannot become XCM-health input.
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

function processedEvent(events, messageId) {
  return events
    .map(({ event }) => event)
    .find((event) => event.section === "messageQueue"
      && event.method === "Processed"
      && event.data.some((value) => value.toHex?.() === messageId));
}

async function waitForProcessed(api, messageId, start) {
  const deadline = Date.now() + 900_000;
  let next = start;
  while (Date.now() < deadline) {
    const head = number((await api.rpc.chain.getHeader()).number);
    while (next <= head) {
      const events = await blockEvents(api, next);
      const processed = processedEvent(events, messageId);
      if (processed) {
        const result = processed.data[processed.data.length - 1];
        if (!result?.isTrue) {
          throw new Error(`client ingress ${messageId} was processed unsuccessfully`);
        }
        return { block: next, events };
      }
      next += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`no successful MessageQueue.Processed receipt for ${messageId}`);
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

async function lifecycle(networkInfo) {
  await zombie.util.cryptoWaitReady();
  const client = await connect(networkInfo, CLIENT_NODE);
  const bleavit = await connect(networkInfo, BLEAVIT_NODE);
  const clientKeys = new zombie.Keyring({ type: "sr25519", ss58Format: client.registry.chainSS58 });
  const bleavitKeys = new zombie.Keyring({ type: "sr25519", ss58Format: bleavit.registry.chainSS58 });
  const alice = clientKeys.addFromUri("//Alice");
  const bob = bleavitKeys.addFromUri("//Bob");
  const charlie = bleavitKeys.addFromUri("//Charlie");
  const dave = bleavitKeys.addFromUri("//Dave");
  const before = await health(bleavit);

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

  const registerStart = number((await bleavit.rpc.chain.getHeader()).number);
  const registerEvents = await submit(governance(client, ask(question)), alice);
  const registerMessage = messageId(registerEvents);
  const registered = await waitForProcessed(bleavit, registerMessage, registerStart);
  const registeredEvent = eventOf(registered.events, "questionService", "QuestionRegistered");
  if (!registeredEvent) throw new Error("successful register has no QuestionRegistered event");
  const questionId = number(registeredEvent.data[0]);
  const record = await readQuestion(bleavit, questionId);

  const bond = bleavit.tx.questionService?.bondAttestor;
  if (!bond) throw new Error("QuestionService.bondAttestor is absent from metadata");
  for (const attestor of [bob, charlie, dave]) {
    await submit(bond(questionId), attestor);
  }

  await waitForBlock(bleavit, record.windowStart);
  const openStart = number((await bleavit.rpc.chain.getHeader()).number);
  const openEvents = await submit(governance(client, open(questionId)), alice);
  const openMessage = messageId(openEvents);
  await waitForProcessed(bleavit, openMessage, openStart);

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
  const sealed = await waitForProcessed(bleavit, sealMessage, sealStart);
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
  return lifecycle(networkInfo);
}

module.exports = { run };
