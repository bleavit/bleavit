// 15 §4.7; 09 §6.1/§6.5 — open the drill topology's HRMP channels AFTER both
// parachains are producing blocks, never at relay genesis (SQ-567).
//
// WHY THIS EXISTS, and why `[[hrmp_channels]]` is deliberately absent from every
// topology that needs a channel.
//
// Zombienet's `[[hrmp_channels]]` directive writes `hrmp.preopenHrmpChannels`
// into the relay genesis. `preopen_hrmp_channels`
// (polkadot-runtime-parachains-28.0.0/src/hrmp.rs:904) calls both
// `init_open_channel` (:1443) and `accept_open_channel` (:1532), and each of
// those queues a DMP notification to the affected para stamped `sent_at = 0`.
//
// On a parachain's very first candidate there is no
// `LastProcessedDownwardMessage`, so cumulus falls back to a sentinel
// (cumulus-pallet-parachain-system-0.29.0/src/lib.rs:1291):
//
//     InboundMessageId { sent_at: LastRelayChainBlockNumber, reverse_idx: 0 }
//
// and `LastRelayChainBlockNumber` is still 0, because it is written in
// `on_finalize` (:334) and no block has finalized yet. `drop_processed_messages`
// (src/parachain_inherent.rs:95) then reverse-scans for the last message whose
// `sent_at` equals the sentinel's, finds the last genesis notification, and
// `drain(..=idx)` removes every one of them. The MQC head is rebuilt from an
// empty list, stays zero, and mismatches the relay's non-zero head, so
// `set_validation_data` trips `assert_eq!(dmq_head.head(), expected)` at
// lib.rs:1362 and the parachain never produces block #1.
//
// The sentinel simply cannot distinguish "nothing processed yet" from "every
// block-0 message already processed". It is not a race and waiting does not
// help: both sides are pinned to state, so every attempt at candidate #1
// recomputes the same sentinel and drops the same messages.
//
// Opening the channels once both paras are live removes the coincidence. The
// notification then carries `sent_at = N` for the current relay block while the
// para's `LastRelayChainBlockNumber` is a strictly earlier relay parent, so the
// reverse scan matches nothing and drops nothing.
//
// Usage (after both collators report a block height):
//   relay-alice: js-script ./js/open-hrmp-channels.js with "4242:1000,1000:4242" within 300 seconds

// Mirrors the `max_capacity` / `max_message_size` the `[[hrmp_channels]]` blocks
// carried before they were removed, so channel geometry is unchanged.
const MAX_CAPACITY = 8;
const MAX_MESSAGE_SIZE = 524288;
const CHANNEL_POLL_MS = 6_000;
const CHANNEL_DEADLINE_MS = 300_000;

function parsePairs(args) {
  const pairs = args
    .join(",")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sender, recipient] = entry.split(":").map((part) => Number(part.trim()));
      if (!Number.isInteger(sender) || !Number.isInteger(recipient)) {
        throw new Error(`malformed HRMP pair "${entry}"; expected "<sender>:<recipient>"`);
      }
      return { sender, recipient };
    });
  if (!pairs.length) throw new Error('no HRMP pairs given; expected e.g. "4242:1000,1000:4242"');
  return pairs;
}

function submit(call, signer, errorPrefix) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (callback) => {
      settled = true;
      if (unsubscribe) unsubscribe();
      callback();
    };
    call
      .signAndSend(signer, ({ dispatchError, events, status }) => {
        if (dispatchError) {
          finish(() => reject(new Error(`${errorPrefix}: ${dispatchError.toString()}`)));
        } else if (status.isInBlock) {
          finish(() => resolve(events));
        }
      })
      .then((unsub) => {
        unsubscribe = unsub;
        if (settled) unsubscribe();
      })
      .catch((error) => finish(() => reject(error)));
  });
}

// A `sudo.sudo` whose INNER call fails still reports a successful outer
// dispatch; the inner failure surfaces only as `sudo.Sudid { result: Err(_) }`.
// Without this check the drill would report a green channel open that never
// happened.
async function sudoSubmit(api, inner, signer, errorPrefix) {
  const events = await submit(api.tx.sudo.sudo(inner), signer, errorPrefix);
  const sudid = events.find(
    ({ event }) => event.section === "sudo" && event.method === "Sudid",
  )?.event;
  if (!sudid) throw new Error(`${errorPrefix}: no sudo.Sudid event was emitted`);
  const result = sudid.data[0];
  if (result?.isErr) {
    throw new Error(`${errorPrefix}: inner call failed: ${result.asErr.toString()}`);
  }
  return events;
}

async function paraHeadNumber(api, paraId) {
  const head = await api.query.paras.heads(paraId);
  if (head.isNone) return null;
  return api.createType("Header", head.unwrap().toU8a(true)).number.toNumber();
}

// The drills wait for both collators to report a block height before invoking
// this script. Asserting the precondition here means the helper cannot be
// reordered into the broken position without saying so.
async function requireParasProducing(api, paraIds) {
  const heights = {};
  for (const paraId of paraIds) {
    const height = await paraHeadNumber(api, paraId);
    if (height === null) throw new Error(`para ${paraId} has no head registered on the relay`);
    if (height < 1) {
      throw new Error(
        `para ${paraId} is still at genesis (head #${height}); opening HRMP now would reproduce ` +
          "the genesis DMQ-head defect this helper exists to avoid",
      );
    }
    heights[paraId] = height;
  }
  return heights;
}

async function waitForChannels(api, pairs) {
  const deadline = Date.now() + CHANNEL_DEADLINE_MS;
  while (Date.now() < deadline) {
    const open = await Promise.all(
      pairs.map(async ({ sender, recipient }) =>
        (await api.query.hrmp.hrmpChannels({ sender, recipient })).isSome,
      ),
    );
    if (open.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, CHANNEL_POLL_MS));
  }
  const pending = await api.query.hrmp.hrmpOpenChannelRequestsList();
  throw new Error(
    `HRMP channels did not open within ${CHANNEL_DEADLINE_MS / 1000}s; ` +
      `${pending.length} request(s) still pending`,
  );
}

async function run(_nodeName, networkInfo, args) {
  const pairs = parsePairs(args);
  const relay = networkInfo.nodesByName["relay-alice"];
  if (!relay) throw new Error("relay-alice is absent from the drill topology");
  const api = await zombie.connect(relay.wsUri, relay.userDefinedTypes);

  if (!api.tx.sudo?.sudo) throw new Error("the relay runtime exposes no sudo.sudo");
  if (!api.tx.hrmp?.forceOpenHrmpChannel) {
    throw new Error("the relay runtime exposes no hrmp.forceOpenHrmpChannel");
  }

  const paraIds = [...new Set(pairs.flatMap(({ sender, recipient }) => [sender, recipient]))];
  const heights = await requireParasProducing(api, paraIds);

  await zombie.util.cryptoWaitReady();
  const keyring = new zombie.Keyring({ type: "sr25519", ss58Format: api.registry.chainSS58 });
  const alice = keyring.addFromUri("//Alice");

  for (const { sender, recipient } of pairs) {
    if ((await api.query.hrmp.hrmpChannels({ sender, recipient })).isSome) continue;
    await sudoSubmit(
      api,
      api.tx.hrmp.forceOpenHrmpChannel(sender, recipient, MAX_CAPACITY, MAX_MESSAGE_SIZE),
      alice,
      `forceOpenHrmpChannel ${sender}->${recipient}`,
    );
  }

  // Accepted requests are normally promoted to live channels only on a session
  // change. `force_process_hrmp_open` (hrmp.rs:609) promotes them immediately;
  // its witness check requires the argument to be >= the pending-request count.
  const pending = await api.query.hrmp.hrmpOpenChannelRequestsList();
  if (pending.length > 0) {
    await sudoSubmit(
      api,
      api.tx.hrmp.forceProcessHrmpOpen(pending.length),
      alice,
      "forceProcessHrmpOpen",
    );
  }

  await waitForChannels(api, pairs);
  const relayBlock = (await api.rpc.chain.getHeader()).number.toNumber();
  return {
    opened: pairs.map(({ sender, recipient }) => `${sender}->${recipient}`),
    relayBlock,
    paraHeadsAtOpen: heights,
  };
}

module.exports = { run };
