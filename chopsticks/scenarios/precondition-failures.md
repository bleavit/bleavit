<!-- 15 §1/§4.7; 02 §11; 09 §1.2. -->
# Dispatch-time precondition failures

1. Start `precondition-failures.yml`; the manufactured cells set hard-gate,
   dead-man, ledger-freeze, and migration-halt conditions simultaneously.
2. For one otherwise valid queued payload at a time, clear all but the target
   cell using `dev_setStorage`, submit `executionGuard.execute(pid)`, and assert
   the matching ordered step-10 refusal. The entry must stay queued and no
   payload state may change.
3. Repeat for version mismatch, absent preimage, ratification, attestation,
   capability, meter, resource-lock, guardian-hold, and payload-bound failures
   using the queue driver from B6.
4. Restore a consistent state and run the closing try-state command.

NOTE(B7): the live failure dispatches require A11 runtime wiring and B6's
upgrade/queue driver. The three injected guard names are taken directly from
the production pallet, not invented fixture storage. All ExecutionGuard cells
are inert until A11 occupies runtime slot 62 (B1a follow-up).
