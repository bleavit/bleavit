// N10: the quickstart includes this file verbatim. The drill proves that a
// client runtime calls one pallet method and that Bleavit's own ingress path
// reaches its deterministic fail-closed service gate before calibration.
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.cwd(), "target", "env", "client-integration-state.json");
const CLIENT_NODE = "client-collator-1";
const BLEAVIT_NODE = "bleavit-collator-1";

function eventOf(events, section, method) {
  return events.find(({ event }) => event.section === section && event.method === method)?.event;
}

function writeState(update) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const old = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    : {};
  fs.writeFileSync(STATE_FILE, `${JSON.stringify({ ...old, ...update }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readState() {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
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

async function blockEvents(api, number) {
  const hash = await api.rpc.chain.getBlockHash(number);
  return (await api.at(hash)).query.system.events();
}

async function waitForRemoteRefusal(api, start) {
  const deadline = Date.now() + 300_000;
  let next = start;
  while (Date.now() < deadline) {
    const head = (await api.rpc.chain.getHeader()).number.toNumber();
    while (next <= head) {
      const events = await blockEvents(api, next);
      const processed = eventOf(events, "messageQueue", "Processed");
      if (processed) {
        const result = processed.data[processed.data.length - 1];
        if (result && result.isFalse) return { block: next, events };
      }
      next += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error("Bleavit did not process the client ingress message");
}

async function register(networkInfo) {
  await zombie.util.cryptoWaitReady();
  const api = await connect(networkInfo, CLIENT_NODE);
  const bleavit = await connect(networkInfo, BLEAVIT_NODE);
  const keyring = new zombie.Keyring({ type: "sr25519", ss58Format: api.registry.chainSS58 });
  const alice = keyring.addFromUri("//Alice");
  const start = (await bleavit.rpc.chain.getHeader()).number.toNumber();
  const ask = api.tx.bleavitClient?.ask;
  if (!ask) throw new Error("pallet-bleavit-client ask call is absent from the client runtime");

  // This is the only application-level input. The pallet derives b, the
  // absolute window, the USDC envelope and every XCM instruction.
  const question = {
    subId: null,
    declaredStake: 100_000_000_000n,
    epsilon1e9: 50_000_000,
    tolerance1e9: 20_000_000,
    window: 1_000,
    attestors: [alice.publicKey, alice.publicKey, alice.publicKey],
    rule: { minAcceptImprovement1e9: 10_000_000 },
  };
  const events = await submit(ask(question), alice);
  const sent = eventOf(events, "bleavitClient", "IngressSent");
  if (!sent) throw new Error("client ask did not emit bleavitClient.IngressSent");
  writeState({ start, messageId: sent.data[sent.data.length - 1].toHex() });
}

async function remoteRefusal(networkInfo) {
  const state = readState();
  if (typeof state.start !== "number") throw new Error("register leg has not run");
  const api = await connect(networkInfo, BLEAVIT_NODE);
  const result = await waitForRemoteRefusal(api, state.start);
  writeState({ processedBlock: result.block, remoteResult: "failed-closed" });
}

async function run(_nodeName, networkInfo, args) {
  const leg = args[0];
  if (leg === "register") return register(networkInfo);
  if (leg === "remote-refusal") return remoteRefusal(networkInfo);
  throw new Error(`unknown client integration leg '${leg}'`);
}

module.exports = { run };
