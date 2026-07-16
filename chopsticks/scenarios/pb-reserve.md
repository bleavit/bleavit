<!-- 15 §1/§4.7; 02 §11; 06 §6.2. -->
# PB-RESERVE steps

1. Start `pb-reserve.yml`; bit 7 is the manufactured runtime-internal reserve
   health trigger and the playbook record is active.
2. Assert `ledger.set_split_paused(true, expiry)` rejects only split inflows;
   merge, redeem, and Asset-Hub exit paths must remain live.
3. Clear the deterministic reserve-health trigger, assert lift/expiry within 14
   days, then run try-state.

NOTE(B7): `ledger.set_split_paused` is not present in the current pallet
metadata and the oracle-to-guardian trigger adapter remains fail-closed. The
scenario is gated on those runtime integration surfaces. The Guardian image's
real membership, arithmetic bonds, activation review, expiry, allowance struct,
and cursors are StorageValues under `Twox128("Guardian") ++ Twox128(item)` and
were SCALE-checked against the Rust types, enabling block-number expiry.

The pallet has no per-playbook allowance, registered-playbook/active-hold, or
downstream effect-revert storage; its review scheduler is a runtime stub and
guardian `CurrentEpoch` stays zero until A8. Those 06 §6.2 gaps are not faked.
