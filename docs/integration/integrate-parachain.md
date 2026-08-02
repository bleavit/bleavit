# Integrating a parachain

Add `pallet-bleavit-client` and implement its small `Config`. The client writes no XCM, no fee
calculation, and no Bleavit metadata encoder. The complete example is in
[`quickstart.md`](quickstart.md).

Non-normative; [16 §2–§3](../architecture/16-hosted-question-service.md) and
[09 §6.5](../architecture/09-execution-upgrades-and-rollout.md) are the owning sections.

## What you actually do

1. Get admitted with the exact client `Location` and open HRMP in both directions.
2. Add `pallet-bleavit-client` to your runtime and implement the route constants, `BleavitOrigin`,
   the fail-closed `SpendingOrigin`, and `OnReport` handler.
3. Fund the client-side USDC route and Bleavit's separate delivery float.
4. Dispatch `BleavitClient::ask`, then `open` and `seal` with typed arguments through the
   configured spending/governance origin.

The pallet derives the subsidy budget and absolute window, encodes the frozen register/open/seal
calls, and builds the strict positional ingress program. A malformed or underfunded request returns
a stable `CLIENT-001`…`CLIENT-016` code before a message is sent.

## Spending authority and callback weight

The three outbound calls debit the same client sovereign account: `ask` chooses the remote
question cost, while `open` and `seal` consume the XCM fee envelope. Configure one origin for that
custody domain and keep the reference default fail-closed:

```rust
use frame_system::EnsureRoot;

impl pallet_bleavit_client::Config for Runtime {
    // ... route constants and the other associated types ...
    type SpendingOrigin = EnsureRoot<AccountId>;
}
```

Widening `SpendingOrigin` from root/governance to a signed or operator origin gives every matching
caller authority to spend the shared sovereign USDC: they can choose an arbitrarily costly
question and consume XCM fees. Make that widening an explicit governance decision; it is not a
convenience default.

`OnReport` is arbitrary client-runtime logic. Its implementation must declare a measured upper
bound with `fn weight() -> Weight`; under-declaring it can overfill a block. The callback returns
`DispatchResultWithPostInfo` and may report its actual handler weight so the pallet can refund the
difference. The obligation belongs to the client runtime that implements the callback.

For registration, the documented escrow and service-fee envelope remain in the sovereign account
for `QuestionService::register` to seed. The positional XCM template withdraws only `XcmFee` at
position 0; position 1's `PayFees` consumes the execution-fee envelope. The remote service fee is
charged from the remaining sovereign balance.

## Push and pull

Push is best-effort and is verified by the pallet's exact Bleavit origin, client id, and v22
provenance hash before `OnReport` runs. Pull is authoritative: read the hosted report against a
finalized header and verify its storage proof and provenance. If the return HRMP channel is absent,
push fails harmlessly and pull remains available.

## The only client-owned policy

`RegistrationFeeBuffer`, `XcmFee`, and `WindowLead` are deployment policy for the client route. They
are deliberately conservative and bounded; they do not replace Bleavit's live `svc.fee_bps` value.
The client does not need to know the live rate or calculate it at a call site.
