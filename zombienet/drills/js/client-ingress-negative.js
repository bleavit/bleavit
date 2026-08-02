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

// `Transact.call` is a SCALE `DoubleEncoded`, which polkadot-js types as the
// struct `{ encoded: Bytes }`. Handing it a bare hex string makes it decode that
// string AS the struct, so the first byte is read as the Bytes length prefix —
// `0x4200` then fails with "required length less than remainder, expected at
// least 4, found 2". Wrapping in `{ encoded }` supplies the byte content and
// lets polkadot-js add the prefix.
//
// The payload is the frozen `[66, 0]` selector (QuestionService::register). Its
// arguments are deliberately absent: every program here is refused at the
// barrier for its SHAPE, so the call body is never decoded and its content is
// irrelevant to what these cases assert.
function transact(originKind = "Xcm", call = "0x4200") {
  return {
    Transact: {
      originKind,
      fallbackMaxWeight: null,
      call: { encoded: call },
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

// A refusal reaches `pallet-message-queue` as ONE OF TWO events, and which one
// depends on how deep the program got:
//
//   * the barrier rejects a mis-shaped program with `ProcessMessageError`
//     (`AllowClientIngress` returns `Unsupported`, client.rs:94), and the queue
//     reports that as `ProcessingFailed { id, origin, error }`;
//   * a program whose SHAPE matches but whose decoded call the ExternalClient
//     filter refuses gets far enough to execute, and the queue reports
//     `Processed { .., success: false }`.
//
// MEASURED (2026-08-02, first green run): all eight cases produce
// `ProcessingFailed` — every one dies at the barrier, none reaches execution.
// That is a STRONGER result than "refused" and the `receipt` field records it
// per case, so a case silently migrating to the later, weaker stage is visible
// in the artifact rather than hidden behind a green tick. An earlier revision of
// this comment claimed the matrix deliberately spans both stages; it does not,
// and the claim was written before any run had ever reported one.
//
// `Processed { success: false }` is still accepted, because it is a genuine
// refusal and the barrier/filter split is an implementation detail this drill
// must not freeze. `Processed { success: true }` is a hard failure either way:
// the point of the matrix is that none of these programs may execute. Watching
// only for `Processed` is what made every barrier-stage refusal invisible and
// timed out as "no refusal receipt" — reporting the strongest possible refusal
// as a missing one.
// Correlation is by QUEUE ORIGIN plus position, never by message id.
//
// Two facts make the obvious approaches wrong, and both cost this drill a run:
//
//   1. `polkadotXcm.Sent.message_id` on the sender and the `id` in the
//      receiver's `messageQueue` events are different quantities — the first is
//      the XCM message id, the second the queue's own hash of the enqueued
//      message. A barrier-refused program never executes `SetTopic`, so nothing
//      ever reconciles them and matching one against the other cannot fire. That
//      is what made this drill report a correct refusal as "no refusal receipt".
//   2. Matching the first queue event in range instead is ALSO wrong here: the
//      post-genesis HRMP open (SQ-567) makes the relay send channel
//      notifications to Bleavit over DMP, and those are `Processed
//      { success: true }`. Taking the first event in range therefore read a
//      relay housekeeping message as this program's receipt and failed with
//      "was EXECUTED".
//
// Both `Processed` and `ProcessingFailed` carry the `AggregateMessageOrigin` as
// their second field, which separates the two cleanly: the client's programs
// arrive as `Sibling(CLIENT_PARA)`, relay notifications as `Parent`. Position
// then disambiguates within that origin, which is sound because the caller sends
// one program and awaits its receipt before sending the next. The sender's id is
// still recorded per case so a human can audit the pairing.
const CLIENT_PARA = 4343;

function isFromClient(event) {
  const origin = event.data[1];
  return origin?.isSibling === true && origin.asSibling.toNumber() === CLIENT_PARA;
}

async function waitForRefusal(api, id, start) {
  const deadline = Date.now() + 240_000;
  let next = start;
  const seen = [];
  while (Date.now() < deadline) {
    const head = (await api.rpc.chain.getHeader()).number.toNumber();
    while (next <= head) {
      const hash = await api.rpc.chain.getBlockHash(next);
      const events = (await (await api.at(hash)).query.system.events()).map(({ event }) => event);
      for (const event of events) {
        if (event.section !== "messageQueue") continue;
        seen.push(`${event.method}(${event.data[1]?.toString?.()})@${next}`);
        if (!isFromClient(event)) continue;
        if (event.method === "ProcessingFailed") {
          return { block: next, receipt: "ProcessingFailed", queueId: event.data[0]?.toHex?.() };
        }
        if (event.method === "Processed") {
          const success = event.data[event.data.length - 1];
          if (!success?.isFalse) {
            throw new Error(`negative ingress ${id} was EXECUTED (Processed success=true) at #${next}`);
          }
          return {
            block: next,
            receipt: "Processed(success=false)",
            queueId: event.data[0]?.toHex?.(),
          };
        }
      }
      next += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  // Report every queue event seen WITH its origin, so a timeout distinguishes
  // "never arrived", "arrived from an unexpected origin" and "arrived in a shape
  // this waiter does not recognise" instead of collapsing all three.
  throw new Error(
    `no messageQueue refusal receipt from Sibling(${CLIENT_PARA}) for negative ingress ${id} `
      + `in blocks ${start}..${next}; messageQueue events seen: `
      + `${seen.length ? seen.join(", ") : "NONE"}`,
  );
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
    const refusal = await waitForRefusal(bleavit, id, start);
    // Record WHICH receipt each case produced: a barrier-stage refusal
    // (ProcessingFailed) and a filter-stage one (Processed success=false) are
    // different guarantees, and a case silently migrating between them is a
    // change in what this matrix proves.
    results.push({
      name,
      messageId: id,
      processedBlock: refusal.block,
      receipt: refusal.receipt,
      result: "refused",
    });
  }
  writeState({ cases: results });
}

async function run(_nodeName, networkInfo, args) {
  if (args[0] !== "malformed") throw new Error(`unknown negative leg '${args[0]}'`);
  return malformed(networkInfo);
}

module.exports = { run };
