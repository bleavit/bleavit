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

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the scenario starts with the manufactured hard-gate, dead-man,
    ledger-freeze, and migration-halt cells set simultaneously
  execute:
    - storage_equals:
        key: "0xfb8ccbf677a3d2ce27ab85165f32df6a4b970b8d50ccb811cd988b36f7f6cf7c"
        value: "0x71000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479289ce573cc45ebc4934cb0c15055d8f075"
        value: "0x01"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479283820e5996b94d5b5353b433dd3ac450b"
        value: "0x01"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479282405b4b29c977f7ec63d38c3ae2db231"
        value: "0x01"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f4792891c90e4173ef123718d6afdf349e68db"
        value: "0x1c626c656176697401000000"
- step: 2
  claim: >-
    clearing all but one target cell and submitting
    executionGuard.execute(pid) yields the matching ordered step-10
    refusal, leaving the entry queued
  blocked_on: >-
    needs a signed-extrinsic driver and B6's queue driver to supply an
    otherwise-valid queued payload
- step: 3
  claim: >-
    the same matrix repeats for version mismatch, absent preimage,
    ratification, attestation, capability, meter, resource-lock,
    guardian-hold, and payload-bound failures
  blocked_on: >-
    depends on the refusal matrix in step 2
- step: 4
  claim: >-
    a consistent state is restored and the closing try-state passes
  blocked_on: >-
    restoration is defined relative to the step 2/3 mutations, which do
    not execute
```
