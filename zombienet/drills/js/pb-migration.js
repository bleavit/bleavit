// 15 §4.7; 06 §5.1/§6.2; 09 §3.2/§7.1 — PB-MIGRATION driver.
function findEvent(events, section, method) {
  return events.find(({ event }) => event.section === section && event.method === method)?.event;
}

function submit(call, signer, expected = []) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (callback) => {
      settled = true;
      if (unsubscribe) unsubscribe();
      callback();
    };
    call.signAndSend(signer, ({ dispatchError, events, status }) => {
      if (dispatchError) {
        finish(() => reject(new Error(dispatchError.toString())));
      } else if (status.isInBlock) {
        const missing = expected.filter(([section, method]) => !findEvent(events, section, method));
        if (missing.length) {
          finish(() => reject(new Error(
            `in-block receipt missing ${missing.map((entry) => entry.join(".")).join(", ")}`,
          )));
        } else {
          finish(() => resolve(events));
        }
      }
    }).then((unsub) => {
      unsubscribe = unsub;
      if (settled) unsubscribe();
    }).catch((error) => finish(() => reject(error)));
  });
}

async function ensureMembershipAndFunding(api, keyring) {
  const membersValue = await api.query.guardian.members();
  if (membersValue.isNone) {
    throw new Error("NOTE(B7): injected seven-seat guardian membership is absent");
  }
  const members = membersValue.unwrap().map((member) => member.toString());
  const signers = ["//Alice", "//Bob", "//Charlie", "//Dave", "//Eve"]
    .map((uri) => keyring.addFromUri(uri));
  const missing = signers.filter((signer) => !members.includes(signer.address));
  if (missing.length) {
    throw new Error(`injected guardian membership omits ${missing.map((s) => s.address).join(", ")}`);
  }

  const alice = signers[0];
  const transfer = api.tx.balances?.transferAllowDeath;
  if (!transfer) throw new Error("balances.transfer_allow_death is absent");
  for (const signer of signers.slice(1)) {
    const account = await api.query.system.account(signer.address);
    if (account.data.free.toBigInt() < 1_000_000_000_000n) {
      await submit(transfer(signer.address, 2_000_000_000_000n), alice);
    }
  }
  return signers;
}

async function guardianRollbackWorkflow(api, keyring) {
  const guardian = api.tx.guardian;
  if (!guardian?.proposeAction || !guardian?.approveAction) {
    throw new Error("guardian propose_action/approve_action workflow is absent");
  }
  const signers = await ensureMembershipAndFunding(api, keyring);
  const height = (await api.rpc.chain.getHeader()).number.toNumber();
  const power = {
    activatePlaybook: {
      id: "Migration",
      trigger: "MigrationHalt",
      expiry: height + 201_600,
    },
  };
  const justification = `0x${"b7".repeat(32)}`;
  const proposed = await submit(
    guardian.proposeAction(power, justification),
    signers[0],
    [["guardian", "ActionProposed"]],
  );
  const action = findEvent(proposed, "guardian", "ActionProposed");
  const actionId = action.data[0].toNumber();
  for (const signer of signers.slice(1, 4)) {
    await submit(guardian.approveAction(actionId), signer, [["guardian", "ActionApproved"]]);
  }
  await submit(
    guardian.approveAction(actionId),
    signers[4],
    [
      ["guardian", "GuardianAction"],
      ["guardian", "PlaybookActivated"],
      ["guardian", "ReviewScheduled"],
    ],
  );
  // No guardian rollback/code-authorize call exists. B6 must bind this real
  // dispatched Migration playbook effect to the forward-upgrade rollback lane.
  return actionId;
}

async function run(nodeName, networkInfo, args) {
  const { wsUri, userDefinedTypes } = networkInfo.nodesByName[nodeName];
  const api = await zombie.connect(wsUri, userDefinedTypes);
  await zombie.util.cryptoWaitReady();
  const keyring = new zombie.Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  const branch = args[0];

  // NOTE(B7): 09 §3.2 retains [VERIFY] on the stable migration-control
  // surface. B6 must expose these bounded calls; placeholders never pass.
  const migrations = api.tx.migrations;
  if (branch === "force-failure") {
    if (!migrations?.forceFailure) {
      throw new Error("NOTE(B7): B6 metadata has no migrations.force_failure call");
    }
    return submit(
      migrations.forceFailure(),
      alice,
      [["migrations", "MigrationHalted"]],
    );
  }
  if (branch === "retry") {
    if (!migrations?.retry) {
      throw new Error("NOTE(B7): B6 metadata has no migrations.retry call");
    }
    return submit(migrations.retry(), alice);
  }
  if (branch === "rollback") return guardianRollbackWorkflow(api, keyring);
  throw new Error(`unknown PB-MIGRATION branch '${branch}'`);
}

module.exports = { run };
