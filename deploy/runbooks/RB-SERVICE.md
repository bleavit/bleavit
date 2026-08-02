---
id: RB-SERVICE
title: Hosted question service — client delivery, occupancy and the external weight partition
owner_role: Service operator
funding_line: ops.keepers
page_immediately: false
alerts:
  - domain: Client report push
    trigger: "any client with ≥ 3 consecutive push failures"
  - domain: Hosted service occupancy
    trigger: "live ≥ 0.9 · svc.max_live, or NotDecisionGrade rejections rising with external occupancy"
  - domain: External block-weight quota
    trigger: "> 80 % of either quota"
spec_refs:
  - docs/architecture/05-welfare-and-decision-engine.md
  - docs/architecture/12-release-and-operations.md
  - docs/architecture/13-parameters.md
  - docs/architecture/16-hosted-question-service.md
---

## Purpose

Keep the hosted question service ([16](../../docs/architecture/16-hosted-question-service.md)) a
well-behaved **tenant** of the chain: clients receive their reports, external occupancy stays inside
the resource partition it was sized for, and — the one that outranks the rest — external activity
never degrades Bleavit's own decision quality.

Three properties bound everything below, and misreading any of them turns a correct alert into a
wrong action:

1. **Push failure is not a chain-health signal.** I-36 puts the client egress router *outside* XCM
   health accounting on purpose. A client that never opens its return channel must not be able to
   move `X`, `C_onchain` or any cohort's `s`. So a push-failure alert is a **customer-integration**
   signal, never a Bleavit-liveness one, and it is never a reason to touch the router.
2. **The pull surface is the authoritative delivery.** Push is best-effort. A client whose pushes are
   all failing is still being served correctly — its report is committed to storage and verifiable by
   proof against a finalized header.
3. **An exhausted external quota is the system working.** The quota is a *partition*, not a budget.
   `H` is computed against the reserved **primary** capacity, so external work saturating its own
   allocation changes nothing for Bleavit. A **breached** quota is a different matter entirely — that
   is a partition defect and escalates immediately.

## Alerts

| Domain | Key series | Trigger |
|---|---|---|
| Client report push | pushes attempted, pushes failed, consecutive failures per client | any client with ≥ 3 consecutive push failures |
| Hosted service occupancy | live external questions, `svc.max_live` headroom, external vs Bleavit contest capital, `NotDecisionGrade` rejections/epoch | live ≥ 0.9 · `svc.max_live`, **or** `NotDecisionGrade` rejections rising with external occupancy |
| External block-weight quota | external ref-time and proof-size used vs the reserved external quota, per block | > 80 % of either quota |

## Diagnosis

**Client report push failures.** Read the per-client attempted, total-failure and consecutive-failure
counters. The deliberately aggregate counter does not persist a last-error code because the outcome
may not become protocol state. Diagnose the bounded possibilities from custody and channel state:

- `NoChannel` — the client never opened, or has since closed, its return HRMP channel. This is the
  I-36 case the design anticipated; nothing on this chain is wrong.
- `Unroutable` / `Transport` — relay-side or XCMP congestion. Correlate with the XCM domain's own
  series; if *protocol* sends are also failing, this is RB-XCM, not this runbook.
- Fee exhaustion — the client's separate USDC `delivery_float` can no longer prepay delivery.
  Confirm the contract-v22 registry field; the native VIT security bond is unrelated and MUST NOT
  be spent on postage. The exact client calls are `top_up_delivery_float(amount)` and
  `withdraw_delivery_float(amount)`; neither accepts a destination, asset or beneficiary.

Confirm the client is actually being served: fetch the question's report through `hosted_report` and
check `provenance_hash` is present. If it is, the product was delivered; only the courtesy copy
failed.

**Occupancy.** Two very different conditions share one alert cell, and they must not be conflated:

- **Headroom** (`live ≥ 0.9 · svc.max_live`) is capacity planning. Benign on its own.
- **`NotDecisionGrade` rejections rising with external occupancy** is the falsifier of
  [16](../../docs/architecture/16-hosted-question-service.md) §8.4 and is *not* benign. It is the
  observable signature of liquidity cannibalization: capital that would have made Bleavit's own
  decision books decision-grade is instead in external books. Establish correlation across at least
  three epochs before acting — a single epoch's rejections are ordinary.

**External weight quota.** Distinguish *saturated* (at or under the reserved allocation — expected)
from *breached* (external work consumed capacity outside its reservation — a defect). Only the second
is an incident. Check whether primary-only `H` moved: it must not have, and if it did, the partition is
not holding and PT-10's property is violated in production.

## Remediation

**Push failures.** Notify the client through the off-chain operational contact established during
admission; the on-chain registry deliberately carries no contact field. There is no on-chain action
and none should be invented. Do **not** retry from the chain, do not re-route, and do not add the
client path to the health-tracking router to "get visibility" — that is precisely the I-36
violation. Point the client at [02 §4a](../../docs/architecture/02-integration-contract.md) and its
authoritative pull surface. If the client's delivery float has drained, it must top up before pushes
resume; report delivery by pull continues regardless.

**Occupancy — headroom.** No action. Record the observation for the values-layer review that sizes
`svc.max_live`.

**Occupancy — the falsifier fires.** This is the one row in the monitoring set whose response is a
**parameter change rather than an operational action**:

1. Confirm the correlation across ≥ 3 epochs using external-vs-Bleavit contest capital.
2. Raise a PARAM amendment **reducing `svc.max_live`**. [16](../../docs/architecture/16-hosted-question-service.md)
   §8.4 states this as a MUST, not a discretion — the values layer committed to cutting the parameter
   if this evidence appeared, and the evidence is the whole reason the series is collected.
3. Do **not** compensate by lowering `dec.v_min`. That is TH-65/TH-73 — trading the decision-grade
   floor for tenancy revenue, which is exactly the failure the falsifier exists to catch.
4. Live questions continue to their own terminal state; the reduced bound applies to new
   registrations.

**Quota saturated.** No action. If sustained, it is input to sizing `svc.max_live`, not an incident.

**Quota breached.** Treat as a partition defect:

1. Guardian-**pause** the service (16 §10). Pause refuses `register` and `seal` and takes live
   questions to VOID at their deadlines — deliberately *not* a freeze, which would strand client and
   trader capital in books with no terminal path.
2. Confirm primary-only `H` in physical `max_block` coordinates and check whether any welfare snapshot
   in the affected window is contaminated.
3. Escalate — this is a code defect in the accounting, not an operational condition.

## Escalation

- **Push failures:** client-facing only. No escalation path on this chain.
- **Falsifier fires:** to the values layer, as a PARAM amendment. Notify treasury ops, since the cut
  reduces instrument-D and instrument-A/B revenue.
- **Quota breached, or `H` moved with external load:** immediate engineering escalation. This
  falsifies PT-10 in production and calls the [16](../../docs/architecture/16-hosted-question-service.md)
  §1 boundary rule into question; the service stays paused until the accounting is repaired and the
  property re-proved.
- **A client's settlement is captured** (attestor majority moved `s` against the evident truth): no
  escalation, and this is deliberate. The blast radius is that question's own escrow, the report
  published `SettlementTrust` before the fact, and Bleavit does not adjudicate foreign facts
  ([07](../../docs/architecture/07-oracle-and-disputes.md); 16 §6.5). Record it for the threat review.

## References

- [16 — Hosted question service](../../docs/architecture/16-hosted-question-service.md) — §8.4 the
  falsifier, §8.5 the resource partition, §9 egress and I-36, §10 pause
- [05 §4.3](../../docs/architecture/05-welfare-and-decision-engine.md) — `H` and the primary-capacity
  reservation; the P-pillar exclusion
- [12 §6.3](../../docs/architecture/12-release-and-operations.md) — the alert tables these rows come from
- [13 §1](../../docs/architecture/13-parameters.md) — `svc.max_live`, `svc.fee_bps`,
  `svc.client_bond`, and the reused `xcm.usdc_per_sec` / `xcm.usdc_per_mb` postage rate card
- [14](../../docs/architecture/14-threat-model.md) TH-69 (egress abuse), TH-72 (liquidity diversion),
  TH-73 (pressure on `svc.max_live` and the certification threshold)
- [RB-XCM](RB-XCM.md) — when protocol sends are failing too
- [RB-GUARDIAN](RB-GUARDIAN.md) — the pause playbook
