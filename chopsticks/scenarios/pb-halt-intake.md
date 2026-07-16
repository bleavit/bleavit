<!-- 15 §1/§4.7; 02 §11; 06 §6.2. -->
# PB-HALT-INTAKE steps

1. Start `pb-halt-intake.yml`; bit 6 is injected as manufactured runtime-only
   dead-man state, one of the admissible triggers.
2. Activate with five guardian approvals and assert
   `epoch.set_intake_paused(true, expiry)` rejects new intake but leaves cranks,
   resolution, exits, and block production live.
3. Advance no more than 14 days, assert automatic lift and expiry event, clear
   bit 6 through the runtime-internal writer, then run try-state.

NOTE(B7): `Epoch` and the spec-named intake-pause call await A8 runtime wiring;
direct PhaseFlags injection is permitted only as a 02 §11 manufactured
precondition. The Guardian image's real membership, arithmetic bonds,
activation review, expiry, allowance struct, and cursors are StorageValues under
`Twox128("Guardian") ++ Twox128(item)` and are SCALE-checked against the Rust
types, so block-number expiry maintenance runs.

The pallet has no per-playbook allowance, registered-playbook/active-hold, or
downstream effect-revert storage. The review scheduler is a runtime stub and
guardian `CurrentEpoch` stays zero until A8; no fake 06 §6.2 cells are supplied.
