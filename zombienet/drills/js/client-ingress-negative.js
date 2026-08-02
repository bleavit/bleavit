// N10 / 16 §12 — live positional-ingress negative matrix.
//
// This helper is intentionally the one place in the local harness that uses
// pallet_xcm.send. It is a test-only sender in the standalone client runtime;
// the integration path remains BleavitClient::ask and cannot submit arbitrary
// XCM. Every case below differs from the six-position template in one shape
// constraint and must be refused by Bleavit's MessageQueue.
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.cwd(), "target", "env", "client-ingress-negative.json");
const CLIENT_NODE = "client-collator-1";
const BLEAVIT_NODE = "bleavit-collator-1";
const DESTINATION = { V5: { parents: 1, interior: { X1: [{ Parachain: 4242 }] } } };
const USDC_ID = {
  parents: 1,
  interior: { X3: [{ Parachain: 1000 }, { PalletInstance: 50 }, { GeneralIndex: 1337 }] },
};
const WRONG_ID = { parents: 1, interior: { X1: [{ Parachain: 1000 }] } };
const REFUND = { parents: 1, interior: { X1: [{ Parachain: 4343 }] } };
const WRONG_BENEFICIARY = { parents: 0, interior: "Here" };

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

function asset(id = USDC_ID, amount = 1_000_000_000n) {
  return { id, fun: { Fungible: amount } };
}

function transact(originKind = "Xcm", call = "0x4200") {
  return {
    Transact: {
      originKind,
      fallbackMaxWeight: null,
      call,
    },
  };
}

function validPrefix(instructions, beneficiary = REFUND) {
  return [
    { WithdrawAsset: [asset()] },
    { PayFees: { asset: asset(USDC_ID, 1_000_000n) } },
    ...instructions,
    { RefundSurplus: null },
    { DepositAsset: { assets: { Wild: { AllCounted: 1 } }, beneficiary } },
    { SetTopic: "0x0101010101010101010101010101010101010101010101010101010101010101" },
  ];
}

function malformedPrograms() {
  const call = transact();
  return [
    ["withdraw-instruction", validPrefix([call]).map((instruction, index) => (
      index === 0 ? { ReserveAssetDeposited: [asset()] } : instruction
    ))],
    ["withdraw-location", validPrefix([call]).map((instruction, index) => (
      index === 0 ? { WithdrawAsset: [asset(WRONG_ID)] } : instruction
    ))],
    ["fee-location", validPrefix([call]).map((instruction, index) => (
      index === 1 ? { PayFees: { asset: asset(WRONG_ID, 1_000_000n) } } : instruction
    ))],
    ["transact-origin", validPrefix([transact("Native")])],
    ["transact-call-domain", validPrefix([transact("Xcm", "0x0000")])],
    ["wrong-position", [
      { WithdrawAsset: [asset()] },
      { PayFees: { asset: asset(USDC_ID, 1_000_000n) } },
      { ClearOrigin: null },
      call,
      { RefundSurplus: null },
      { DepositAsset: { assets: { Wild: { AllCounted: 1 } }, beneficiary: REFUND } },
      { SetTopic: "0x0202020202020202020202020202020202020202020202020202020202020202" },
    ]],
    ["beneficiary", validPrefix([call], WRONG_BENEFICIARY)],
    ["trailing-instruction", [
      ...validPrefix([call]),
      { ClearOrigin: null },
    ]],
  ].map(([name, instructions]) => [name, { V5: instructions }]);
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

function messageId(events) {
  const sent = eventOf(events, "polkadotXcm", "Sent");
  if (!sent) throw new Error("raw negative sender did not emit polkadotXcm.Sent");
  return sent.data[sent.data.length - 1].toHex();
}

async function connect(networkInfo, nodeName) {
  const node = networkInfo.nodesByName[nodeName];
  if (!node) throw new Error(`topology has no node '${nodeName}'`);
  return zombie.connect(node.wsUri, node.userDefinedTypes);
}

async function waitForRefusal(api, id, start) {
  const deadline = Date.now() + 300_000;
  let next = start;
  while (Date.now() < deadline) {
    const head = (await api.rpc.chain.getHeader()).number.toNumber();
    while (next <= head) {
      const hash = await api.rpc.chain.getBlockHash(next);
      const events = await (await api.at(hash)).query.system.events();
      const processed = events
        .map(({ event }) => event)
        .find((event) => event.section === "messageQueue"
          && event.method === "Processed"
          && event.data.some((value) => value.toHex?.() === id));
      if (processed) {
        const result = processed.data[processed.data.length - 1];
        if (!result?.isFalse) throw new Error(`negative ingress ${id} was not refused`);
        return next;
      }
      next += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`no refusal receipt for negative ingress ${id}`);
}

async function malformed(networkInfo) {
  await zombie.util.cryptoWaitReady();
  const client = await connect(networkInfo, CLIENT_NODE);
  const bleavit = await connect(networkInfo, BLEAVIT_NODE);
  const keyring = new zombie.Keyring({ type: "sr25519", ss58Format: client.registry.chainSS58 });
  const alice = keyring.addFromUri("//Alice");
  const results = [];
  for (const [name, message] of malformedPrograms()) {
    const start = (await bleavit.rpc.chain.getHeader()).number.toNumber();
    const events = await submit(client.tx.polkadotXcm.send(DESTINATION, message), alice);
    const id = messageId(events);
    const block = await waitForRefusal(bleavit, id, start);
    results.push({ name, messageId: id, processedBlock: block, result: "refused" });
  }
  writeState({ cases: results });
}

async function run(_nodeName, networkInfo, args) {
  if (args[0] !== "malformed") throw new Error(`unknown negative leg '${args[0]}'`);
  return malformed(networkInfo);
}

module.exports = { run };
