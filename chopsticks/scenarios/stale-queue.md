<!-- 15 §1/§4.7; 02 §11; 09 §1.2(3). -->
# StaleQueue steps

1. Start `stale-queue.yml`; its real `Queue[1]` value has a frozen Bleavit
   spec-version-2 constraint against live spec-version 1, a future grace end,
   and the required `Expedited[1]=false` companion marker.
2. Produce at least two blocks, then submit permissionless
   `executionGuard.rejectStale(1)`.
3. Assert the proposal transitions to `Rejected(StaleQueue)`, no payload item
   dispatches, locks/preimage pins release, and the queue counter returns to
   zero.
4. Run the closing try-state command.

`Queue[1]` uses `Blake2_128Concat(SCALE u64(1))`; its 73-byte value was
SCALE-encoded against `QueueEntry` with `grace_end=1_000_000` and
`RuntimeVersionConstraint { spec_name: b"bleavit", spec_version: 2 }`.
`Expedited[1]` uses the same hasher/key tail and encodes bool false as `00`.

NOTE(B7): the cells are inert until A11 occupies runtime slot 62 (B1a
follow-up). The full `reject_stale` transition also needs A8/B6 to manufacture
proposal 1 in `Queued`; guard-only storage is internally try-state-shaped but
does not pretend that cross-pallet precondition already exists.

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the scenario starts with the real Queue[1] entry carrying a frozen
    bleavit/2-vs-live-1 constraint, a future grace end, and
    Expedited[1]=false
  execute:
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f47928176b47d9aa103add5fb8dc68d3c6c165"
        value: "0x01000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f479287a04cf465f6cde79f5825e350c74814a9ea2d098b5f70192f96c06f38d3fbc970100000000000000"
        value: "0x0100000000000000111111111111111111111111111111111111111111111111111111111111111104000000000000000040420f001c626c6561766974020000000000000000000000"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f4792847149234daa42aa4242b2806dc5e0a129ea2d098b5f70192f96c06f38d3fbc970100000000000000"
        value: "0x00"
    - storage_equals:
        key: "0x0fa4af4f19b810e797f335f5b2f4792891c90e4173ef123718d6afdf349e68db"
        value: "0x1c626c656176697401000000"
- step: 2
  claim: >-
    at least two blocks are produced and permissionless
    executionGuard.rejectStale(1) is submitted
  blocked_on: >-
    needs a signed-extrinsic driver and A8/B6 wiring to manufacture
    proposal 1 in Queued
- step: 3
  claim: >-
    the proposal transitions to Rejected(StaleQueue), no payload
    dispatches, locks/preimage pins release, and the queue counter returns
    to zero
  blocked_on: >-
    depends on the rejectStale dispatch in step 2
- step: 4
  claim: >-
    the closing try-state check passes
  discharged_by: try-state
```
