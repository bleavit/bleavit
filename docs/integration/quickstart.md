# Quickstart — zero to a first question

Non-normative. The client-para topology runs the executable JavaScript block below verbatim. The
binding gate compares this block byte-for-byte with `zombienet/drills/js/client-quickstart.js`, then
`node --check` validates the file that the drill executes. If either copy changes, CI fails.

**Prerequisites:** your chain is admitted to Bleavit's client registry, an HRMP channel exists in
both directions, and the client runtime has the USDC route policy configured. The hosted service
itself remains fail-closed until its governed fee rate is set; the local drill proves that refusal
path before calibration.

## 1. Add the pallet

```toml
# runtime/Cargo.toml
pallet-bleavit-client = { git = "https://github.com/bleavit/bleavit", default-features = false }
```

## 2. Implement the `Config`

The client runtime supplies route constants and one report handler. It never writes an XCM program,
computes a service fee, or encodes a Bleavit call.

```rust
use frame_support::{
    dispatch::{DispatchResultWithPostInfo, PostDispatchInfo},
    parameter_types,
    traits::Get,
    weights::Weight,
};
use frame_system::EnsureRoot;
use futarchy_primitives::{AccountId, Balance, BlockNumber, ClientId, FixedU64};
use pallet_bleavit_client::{ClientRule, Question, ReportView};
use staging_xcm::latest::{Junction, Location};

parameter_types! {
    pub BleavitLocation: Location = Location::new(1, [Junction::Parachain(4242)]);
    pub UsdcLocation: Location = Location::new(
        1,
        [Junction::Parachain(1000), Junction::PalletInstance(50), Junction::GeneralIndex(1337)],
    );
    pub RefundLocation: Location = Location::new(1, [Junction::Parachain(4343)]);
    pub const ClientId: ClientId = 1;
    pub const RegistrationFeeBuffer: Balance = 2_000_000_000_000;
    pub const XcmFee: Balance = 1_000_000_000;
    pub const WindowLead: BlockNumber = 20;
    pub const MaxReports: u32 = 128;
}

pub struct MyDecisionRule;
impl pallet_bleavit_client::OnReport for MyDecisionRule {
    fn weight() -> Weight {
        // This is the measured upper bound for the whole callback, including
        // enact_local_policy's storage and computation.
        MyDecisionRuleWeight::get()
    }

    fn on_report(report: &ReportView) -> DispatchResultWithPostInfo {
        let spread = report.twap_accept_1e9.0.saturating_sub(report.twap_reject_1e9.0);
        if report.certified && spread >= 100_000_000 {
            enact_local_policy(report.question_id)?;
        }
        // Return the actual callback weight when the handler can measure it;
        // default() means no refund, not permission to under-declare weight().
        Ok(PostDispatchInfo::default())
    }
}

impl pallet_bleavit_client::Config for Runtime {
    type BleavitLocation = BleavitLocation;
    type UsdcLocation = UsdcLocation;
    type RefundLocation = RefundLocation;
    type ClientId = ClientId;
    type RegistrationFeeBuffer = RegistrationFeeBuffer;
    type XcmFee = XcmFee;
    type WindowLead = WindowLead;
    type XcmSender = ClientXcmpRouter;
    type BleavitOrigin = EnsureBleavitSovereign;
    // Reference default: only root/governance may spend the shared sovereign
    // account. Widening this grants every matching caller spending authority.
    type SpendingOrigin = EnsureRoot<AccountId>;
    type OnReport = MyDecisionRule;
    type MaxReports = MaxReports;
    type WeightInfo = pallet_bleavit_client::weights::SubstrateWeight<Runtime>;
}
```

`RegistrationFeeBuffer` is a conservative envelope for the live service fee and floor; it is not a
second protocol tariff. `WindowLead` absorbs delivery latency before the pallet derives the remote
absolute window. Both are client-runtime deployment policy, not values-layer protocol parameters.
The escrow and service-fee envelope stays in the sovereign account for remote registration; the
positional program withdraws only `XcmFee` at `WithdrawAsset` position 0 and pays it at position 1.

`SpendingOrigin` intentionally defaults to root/governance. Widening it to a signed or operator
origin lets every matching caller choose costly questions and consume the client chain's XCM fees.
`OnReport::weight()` must be a measured upper bound for the complete callback. Under-declaring the
handler is unsafe; return actual handler weight through `PostDispatchInfo` when it is available so
the pallet can refund the difference.

## 3. Ask, open, and seal

The client writes only typed terms. The pallet derives the LMSR seed budget, encodes the frozen
`QuestionService` call, and builds the positional `WithdrawAsset → PayFees → Transact →
RefundSurplus → DepositAsset → SetTopic` program.

```rust
BleavitClient::ask(
    origin,
    Question {
        sub_id: Some(proposal_id),
        declared_stake: 100_000 * USDC,
        epsilon_1e9: FixedU64(50_000_000),
        tolerance_1e9: FixedU64(20_000_000),
        window: 30 * DAYS,
        attestors: bounded_attestors(alice, bob, carol)?,
        rule: ClientRule { min_accept_improvement_1e9: FixedU64(10_000_000) },
    },
)?;

BleavitClient::open(origin, question_id)?;
BleavitClient::seal(origin, question_id)?;
```

There is no call-site fee arithmetic, metadata lookup, SCALE encoder, or XCM authoring. A rejected
request returns one of the pallet's `CLIENT-001`…`CLIENT-016` errors locally, or the deterministic
architecture-16 service error in the remote message result.

## 4. Trust the answer

Push is a best-effort convenience. The pallet verifies the exact Bleavit origin, client id, and v22
provenance hash before it calls `OnReport`; a handler refusal rolls back the report write. For a
pull, read `BleavitClient::Reports` locally, or read `QuestionService::Reports` from Bleavit using
a finalized-header storage proof. The TypeScript kit performs the latter check for services and
frontends.

## 5. Run the integration drill

Build the two chain specs and spawn the topology:

```bash
tools/env/generate-relay-specs.sh
tools/deploy/generate-client-chain-spec.sh
zombienet spawn zombienet/drills/10-client-integration.zndsl
```

The drill submits only `bleavitClient.ask` on the client para, observes `IngressSent`, and waits for
Bleavit's message queue to process the exact program. The default uncalibrated service refuses with
its fail-closed gate; that is intentional evidence that the complete route is live before the
fee-rate value is adopted.

<!-- quickstart-drill-source:begin -->
```javascript
// N10: the quickstart includes this file verbatim. The drill proves that a
// client governance origin calls one pallet method and that Bleavit's own ingress path
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
  const sudo = api.tx.sudo?.sudo;
  if (!ask || !sudo) {
    throw new Error("client runtime must expose bleavitClient.ask behind the governance sudo path");
  }

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
  // The reference runtime binds SpendingOrigin to EnsureRoot. Sudo is only
  // the harness governance wrapper; an integrator should submit through its
  // own root/governance origin instead of widening the pallet to signed users.
  const events = await submit(sudo(ask(question)), alice);
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
```
<!-- quickstart-drill-source:end -->
