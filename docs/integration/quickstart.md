# Quickstart — zero to a first question

Non-normative. The code here is the code the integration drill runs in CI, so if it drifts, CI
notices — that binding is what keeps this file from rotting.

**Prerequisites:** your chain is admitted to the client registry, an HRMP channel exists in both
directions, and you hold USDC on Bleavit.

---

## 1. Add the pallet

```toml
# runtime/Cargo.toml
pallet-bleavit-client = { git = "https://github.com/bleavit/bleavit", default-features = false }
```

## 2. Implement the `Config`

Four things: what you are measuring, what would change your mind, how sure you need to be, and
what to do when the answer arrives.

```rust
impl pallet_bleavit_client::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;

    /// Where Bleavit lives.
    type BleavitLocation = BleavitParachain;

    /// Your opaque per-request tag. Bleavit stores it, echoes it back in the
    /// report, binds it into the provenance hash — and never interprets it.
    /// This is where you carry per-user or per-proposal identity, because
    /// Bleavit authenticates you as a *chain*, not as a caller.
    type SubId = [u8; 32];

    /// Your decision rule. Runs on YOUR chain, with YOUR data. Bleavit never
    /// sees it and never learns what it returned.
    type OnReport = MyDecisionRule;

    type WeightInfo = ();
}

pub struct MyDecisionRule;
impl pallet_bleavit_client::OnReport for MyDecisionRule {
    fn on_report(report: &ReportView) -> DispatchResult {
        // Two prices, a floor, and a certificate. Your threshold is yours.
        let spread = report.twap_accept_1e9.saturating_sub(report.twap_reject_1e9);

        let trustworthy = report.certified
            && report.manip_floor >= MY_ADVERSARY_BUDGET
            && report.observations >= MY_COVERAGE_FLOOR;

        if trustworthy && spread > MY_THRESHOLD {
            Self::enact()?;
        }
        Ok(())
    }
}
```

**Note what is absent.** You never build an XCM program, never compute a fee, never encode a call.
The ingress program Bleavit accepts is a strict positional template, and hand-authoring one is easy
to get wrong and always refused — so the builder ships with the pallet and the strictness is
invisible to you.

## 3. Ask a question

```rust
BleavitClient::ask(
    origin,
    Question {
        text_hash: blake2_256(b"Will 30d active addresses exceed 10k if we adopt proposal 42?"),
        sub_id: proposal_id.into(),
        declared_stake: 100_000 * USDC,   // what this decision is worth to you
        epsilon: Perbill::from_percent(5), // the smallest move that would change your mind
        window: 30 * DAYS,
        attestors: vec![alice, bob, carol], // who reports the realized value
        rule: ClientRule::AcceptExceedsReject,
    },
)?;
```

Budget check before you send: at ε = 5 % and `S` = 100 k you post roughly **1.97 M USDC** of
escrow, most of which returns. If that is a surprise, read [`costs.md`](costs.md) — it is the
number people miss, and it is what makes the certificate mean anything.

## 4. Wait

Trading runs for your window. Nothing is required from you.

## 5. Receive the report

`OnReport` fires when Bleavit pushes. **Push is best-effort** — if your channel is closed or your
delivery float is dry, the push fails and nothing else does.

**The pull surface is the authoritative one**, and for anything that matters you should use it:

```rust
let report = BleavitClient::fetch_report(question_id)?;  // by storage proof,
                                                          // against a finalized header
```

## 6. Settle

Your named attestors report the realized value within 72 hours. The median of a `⌈n/2⌉` quorum
settles it; anyone deviating beyond tolerance is slashed. If they fail, the question **VOIDs** and
everyone redeems at par — **your report is unaffected**, because it was published at seal, before
settlement risk existed.

See [`settlement.md`](settlement.md), especially the residual-risk section: you choose your
attestors, and the report publishes how much that choice is worth trusting.

---

## Test it locally first

The Zombienet client-para topology is a release artifact, not a private fixture. Run your
integration end to end before you touch a live network:

```bash
zombienet spawn zombienet/client-para.toml
```

It includes a **return-channel-absent** variant, which is worth running deliberately: it is the
case where pushes fail and pull still works, and you want to find out that your integration handles
it here rather than in production.
