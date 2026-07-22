<!-- 15 §1/§4.7; 02 §11; 09 §2.1. -->
# Upgrade transition steps

> **Stale since 2026-07-20 (SQ-127/SQ-144 ruled).** This card still images the
> retired paired `PendingUpgrade` + two-hash checkpoint form. The anchor is now
> captured at code *application*, is `(block_number, block_hash)`, lives in its
> own guard item, and try-state is a one-way implication (09 §3.2(2)). Re-image
> when the implementation lands (PLAN.md SQ-127/SQ-144, batch X).


1. Authorize branch: remove the checked-in `PendingUpgrade` override, have the
   B6 driver enqueue a fully attested CODE proposal, and drive it through
   `execute(pid)`. Assert its resulting pending record exactly matches the
   checked-in field shape and `UpgradeAuthorized` is emitted.
2. Apply branch: restart `upgrade-transition.yml`, replace the commented
   `wasm-override` with the candidate Wasm compiled with `try-runtime`, and
   retain the manufactured pending/checkpoint/authorization-history tuple.
   Replace the `aa..` placeholder with `blake2_256` of the exact code bytes.
3. Call `executionGuard.applyAuthorizedUpgrade(code)` only at or after
   `applicable_at`; assert `UpgradeApplied` and that the pending cell clears.
4. Exercise the frontend sequence full → read-only-incompatible → compatible
   newer release, and run the README closing try-state command.

Encoding derivation: all five cells are `StorageValue`s, so each key is
`Twox128("ExecutionGuard") ++ Twox128(item)`. `PendingUpgrade` is `[u8;32] ++
u32(0) ++ u32(43_200) ++ u32(2)`; the checkpoint is two raw `[u8;32]` values;
history is Compact(1)=`04` followed by `(u32(0), u32(432_000))`. These values
were SCALE-checked against the real pallet types.

NOTE(B7): the cells are inert until A11 occupies runtime slot 62 (B1a
follow-up). The end-to-end path remains gated on B6 plus that wiring.

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the authorize branch drives a fully attested CODE proposal through
    execute(pid) and emits UpgradeAuthorized with the imaged pending
    record
  blocked_on: >-
    A8/B6 must enqueue and drive an attested CODE proposal; the imaged
    paired PendingUpgrade+checkpoint form is also retired by the
    SQ-127/SQ-144 ruling and awaits re-imaging
- step: 2
  claim: >-
    the apply branch restarts against the candidate try-runtime Wasm with
    the manufactured pending/checkpoint/authorization-history tuple
    retained
  blocked_on: >-
    requires an active wasm-override candidate build; the runner
    deliberately refuses configs that define one (release evidence must
    fork the release Wasm)
- step: 3
  claim: >-
    executionGuard.applyAuthorizedUpgrade(code) at or after applicable_at
    emits UpgradeApplied and clears the pending cell
  blocked_on: >-
    needs a signed-extrinsic driver plus the B6 authorize/apply surface
- step: 4
  claim: >-
    the frontend transition sequence full -> read-only-incompatible ->
    compatible newer release renders, then the closing try-state passes
  blocked_on: >-
    frontend transition assertions wait on Track F
```
