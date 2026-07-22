<!-- 15 §1/§4.7; 06 §6.2; 09 §3.2. -->
# PB-MIGRATION steps

> **Stale since 2026-07-20 (SQ-127/SQ-144 ruled).** This card still images the
> retired paired `PendingUpgrade` + two-hash checkpoint form. The anchor is now
> captured at code *application*, is `(block_number, block_hash)`, lives in its
> own guard item, and try-state is a one-way implication (09 §3.2(2)). Re-image
> when the implementation lands (PLAN.md SQ-127/SQ-144, batch X).


1. Start `pb-migration.yml`; verify the real migration halt, active playbook,
   and paired pending/checkpoint/authorization-history cells.
2. Resource-bounded branch: invoke the bounded continuation control no more
   than twice, assert a successful retry clears the halt only after try-state.
3. Rollback branch: manufacture a logic/storage-shape fault or a second failed
   retry, assert the default within 72 hours is a forward remediation upgrade
   through the expedited CODE lane with full attestation and ratification.
4. Assert ordinary affected-surface transactions and the execution queue stay
   halted throughout, then run try-state after recovery.

NOTE(B7): 09 §3.2 retains `[VERIFY pallet-migrations control surface]`; B6
must bind the retry and forward-rollback calls. The checkpoint-lifetime-during-
halt question is logged as a `PLAN.md` spec question; until resolved, this card
uses the try-state-valid paired PendingUpgrade+Checkpoint form. The values are
SCALE `[u8;32] ++ u32(0) ++ u32(43_200) ++ u32(2)`, a two-hash checkpoint,
`u32(0)` last authorization, and Compact(1)+`(u32(0),u32(0))` expedited
history, verified against the real types.

NOTE(B7): the ExecutionGuard cells are inert until A11 occupies runtime slot
62 (B1a follow-up).

The Guardian side is live now: its real members, arithmetic bonds, activation
review, expiry, allowance struct, and cursors are StorageValues keyed by
`Twox128("Guardian") ++ Twox128(item)` and SCALE-checked against the Rust types,
so block-number expiry maintenance runs. The pallet has no per-playbook
allowance, registered-playbook/active-hold, migration-resolved lift, or
downstream effect-revert storage. The runtime review scheduler remains a stub
and guardian `CurrentEpoch` stays zero until A8; no 06 §6.2 state is invented.

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the scenario starts with the real migration halt, the active playbook,
    and the paired pending/checkpoint/authorization-history cells
  execute:
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfeba7fb8745735dc3be2a2c61a72c39e78"
        value: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a4890b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe22306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc20e659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07cbe5ddb1579b72e84524fc29e78609e3caf42e85aa118ebfe0b0ad404b5bdd25f"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfebe7bff8faeef0eb151acae65b4483172"
        value: "0x0000c52ebca2b10000000000000000000000c52ebca2b10000000000000000000000c52ebca2b10000000000000000000000c52ebca2b10000000000000000000000c52ebca2b10000000000000000000000c52ebca2b10000000000000000000000c52ebca2b1000000000000000000"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe7123b19f85b171b1e607ef6ab73aca8d"
        value: "0x00"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe3c9c1284130706f5aea0c8b3d4c54d89"
        value: "0x00"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe3b35243f44e930f74321349370290616"
        value: "0x0400000000020000000000d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a4890b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe22306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc20e659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe98423d8735b6b0030a9466759a4e35fc"
        value: "0x04018013030000"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfee5a204f36aba91f752605821b239b5e0"
        value: "0x00"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfedb006b293d52def90ae21a5336f065c1"
        value: "0x00000000000000"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe45b7f85ab1600a438ed48a72dc80a191"
        value: "0x01000000"
    - storage_equals:
        key: "0xc6a3f459c346b019951793fb83a56dfe12affbfd6adbcf8f9c36b398be23678b"
        value: "0x00000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479282405b4b29c977f7ec63d38c3ae2db231"
        value: "0x01"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479283d687b5785c6f93388a1e8978c48102f"
        value: "0xccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479285aa1e59659356d7bccc0c9ca5fdfa73f"
        value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000c0a8000002000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f4792891c90e4173ef123718d6afdf349e68db"
        value: "0x1c626c656176697401000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f47928815f330a7ed1a3d487568a6b29a84051"
        value: "0x00000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f4792854dd959e0c1308f840e2d08ea231f234"
        value: "0x040000000000000000"
- step: 2
  claim: >-
    the bounded continuation control is invoked at most twice and a
    successful retry clears the halt only after try-state
  blocked_on: >-
    09 §3.2 still carries [VERIFY pallet-migrations control surface]; B6
    must bind the retry call
- step: 3
  claim: >-
    a logic/storage-shape fault or a second failed retry defaults within
    72 hours to a forward remediation upgrade through the expedited CODE
    lane
  blocked_on: >-
    the forward-rollback call is unbound and the imaged paired checkpoint
    form is retired by SQ-127/SQ-144
- step: 4
  claim: >-
    ordinary affected-surface transactions and the execution queue stay
    halted throughout, then try-state passes after recovery
  blocked_on: >-
    depends on the retry/rollback dispatches in steps 2 and 3
```
