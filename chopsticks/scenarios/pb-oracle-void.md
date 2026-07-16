<!-- 15 §1/§4.7; 06 §6.2. -->
# PB-ORACLE-VOID steps

1. Start `pb-oracle-void.yml`, manufacture an oracle deadlock/gate-input
   failure for a real cohort, and activate with five guardian approvals.
2. Assert the one-shot `epoch.void_cohort(epoch_id)` dispatch invokes
   `ledger.void(pid)` through ResolveAuthority for every cohort proposal.
3. Assert ordinary resolution cannot replace `Voided`, the playbook is consumed
   once, and the VOID redeem flow remains available; run try-state.

NOTE(B7): the `Epoch` pallet and its ResolveAuthority bridge await A8 runtime
wiring. The Guardian image includes real membership, arithmetic bonds,
activation review, expiry, allowance struct, and cursors; all are StorageValues
under `Twox128("Guardian") ++ Twox128(item)`, with the bounded vectors and
records SCALE-checked against their Rust types. That membership makes automatic
block-number expiry run.

There is no per-playbook allowance, registered-playbook/active-hold, one-shot
consumption, or downstream effect-revert storage in the pallet. The runtime
review scheduler is a stub and guardian `CurrentEpoch` stays zero until A8, so
the card names those 06 §6.2 gaps instead of inventing cells.
