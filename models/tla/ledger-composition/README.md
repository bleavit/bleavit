# Two-instance ledger composition model

`LedgerComposition.tla` is the bounded composition check required by 03 §1a,
15 §4.3 PT-9 and I-37. It models primary and service custody, liabilities,
position/deposit state, per-instance reconciliation latches, and the three
account predicates. Every active-domain action records whether the other
domain's fingerprint stayed unchanged. `MutationCrossInstance.cfg` deliberately
couples a custody fault to the other latch and must violate
`NoCrossInstanceMutation`.

The model complements the generated FRAME PT-9 matrix and the Instance1 corpus
replay: it proves the composition rule over all interleavings in its finite
scope; those Rust suites cover the production operation alphabet and storage.
`Small.cfg` currently reaches 15,571 distinct states; the manifest floor is
7,500 so material state-space collapse fails mechanically.
