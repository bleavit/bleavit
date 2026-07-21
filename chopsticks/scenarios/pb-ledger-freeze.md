<!-- 15 §1/§4.7; 02 §11; 06 §6.2/§6.3; 09 §3.1/§4. -->
# PB-LEDGER-FREEZE steps

1. Before activation, manufacture a sovereign-vs-ledger reconciliation drift
   through the real ledger/collateral cells and assert the runtime's I-4 signal;
   five guardians may activate only while that signal is live. The checked-in
   post-entry image carries the real `ActivePlaybooks` record and machinery-only
   PhaseFlags bit 5.
2. Assert `ledger.set_frozen(true)` and `market.set_frozen(true)` reject every
   specified ledger/market call while reconciliation, guardian, values, and
   oracle paths remain live.
3. While frozen, fund a valid `ops.coretime` quote and submit signed
   `futarchyTreasury.executeCoretimeRenewal(period_index)`. Assert it succeeds;
   no other treasury outflow receives the exemption.
4. Entry/expiry branch: advance to the real 201,600-block bound, assert automatic
   lift. Renewal branch: approve exactly one values-track renewal and assert a
   second renewal is impossible.
5. Auto-lift branch: repair custody, run reconciliation, assert bit 5 and both
   freezes clear early. Finish with try-state only after the I-4 drift clears.

NOTE(B7): there is no stored `DriftFlag` item to inject—the current ledger
detects drift in try-state and the guardian trigger adapter is fail-closed—so
this card deliberately does not invent one. The live entry assertion requires
the reconciliation-trigger adapter. The spec-named ledger/market freeze calls
are also absent from current metadata, and the treasury XCM renewal dispatcher
remains unwired; all three are explicit runtime-integration gates.

The Guardian image includes its real members, arithmetic bonds, activation
review, expiry, allowance struct, and cursors. All are StorageValues keyed by
`Twox128("Guardian") ++ Twox128(item)` and SCALE-checked against the real Rust
types, so block-number expiry runs. The pallet has no per-playbook allowance,
registered-playbook/active-hold, early-lift, or downstream effect-revert storage;
renewal/expiry also do not create the 06 §6.3 review. The runtime review
scheduler is a stub and guardian `CurrentEpoch` stays zero until A8; none of
those missing cells are fabricated.

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    a sovereign-vs-ledger reconciliation drift is manufactured through the
    real ledger/collateral cells and the runtime's I-4 signal asserts
    before activation
  blocked_on: >-
    there is no stored DriftFlag item to inject — the ledger detects drift
    in try-state and the reconciliation-trigger adapter is fail-closed
- step: 2
  claim: >-
    ledger.set_frozen(true) and market.set_frozen(true) reject every
    specified ledger/market call while reconciliation, guardian, values,
    and oracle paths stay live
  blocked_on: >-
    the spec-named ledger/market freeze calls are absent from current
    metadata
- step: 3
  claim: >-
    while frozen, a funded ops.coretime quote lets signed
    futarchyTreasury.executeCoretimeRenewal(period_index) succeed, and no
    other treasury outflow receives the exemption
  blocked_on: >-
    needs a signed-extrinsic driver and a funded ops.coretime line, which
    is not chain-spec-fundable
- step: 4
  claim: >-
    the entry/expiry branch lifts automatically at the real 201,600-block
    bound and exactly one values-track renewal is possible
  blocked_on: >-
    renewal/expiry create no 06 §6.3 review and there is no active-hold
    storage
- step: 5
  claim: >-
    repairing custody and running reconciliation clears bit 5 and both
    freezes early, and try-state passes only after the I-4 drift clears
  blocked_on: >-
    there is no early-lift or effect-revert storage in the pallet
```
