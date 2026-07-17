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
