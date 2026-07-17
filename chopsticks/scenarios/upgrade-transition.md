<!-- 15 §1/§4.7; 02 §11; 09 §2.1. -->
# Upgrade transition steps

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
