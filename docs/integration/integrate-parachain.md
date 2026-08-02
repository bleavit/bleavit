# Integrating a parachain

Add `pallet-bleavit-client` and implement its small `Config`. The client writes no XCM, no fee
calculation, and no Bleavit metadata encoder. The complete example is in
[`quickstart.md`](quickstart.md).

Non-normative; [16 §2–§3](../architecture/16-hosted-question-service.md) and
[09 §6.5](../architecture/09-execution-upgrades-and-rollout.md) are the owning sections.

## What you actually do

1. Get admitted with the exact client `Location` and open HRMP in both directions.
2. Add `pallet-bleavit-client` to your runtime and implement the route constants, `BleavitOrigin`,
   and `OnReport` handler.
3. Fund the client-side USDC route and Bleavit's separate delivery float.
4. Dispatch `BleavitClient::ask`, then `open` and `seal` with typed arguments.

The pallet derives the subsidy budget and absolute window, encodes the frozen register/open/seal
calls, and builds the strict positional ingress program. A malformed or underfunded request returns
a stable `CLIENT-001`…`CLIENT-016` code before a message is sent.

## Push and pull

Push is best-effort and is verified by the pallet's exact Bleavit origin, client id, and v22
provenance hash before `OnReport` runs. Pull is authoritative: read the hosted report against a
finalized header and verify its storage proof and provenance. If the return HRMP channel is absent,
push fails harmlessly and pull remains available.

## The only client-owned policy

`RegistrationFeeBuffer`, `XcmFee`, and `WindowLead` are deployment policy for the client route. They
are deliberately conservative and bounded; they do not replace Bleavit's live `svc.fee_bps` value.
The client does not need to know the live rate or calculate it at a call site.
