<!-- 15 §1/I-26/I-27/§4.7/§4.8; 02 §11. -->
# VOID epoch and redeem steps

1. Start `void-epoch.yml`. It injects a real `Vaults[1]` in `Voided`, Alice's
   Accept/Reject branch-USDC positions, both totals, position count/deposits,
   and the matching `ForeignAssets` sovereign custody.
2. Submit `conditionalLedger.redeemVoid(1, Accept, BranchUsdc, 1000000)` and
   assert a 500000-planck payout, then repeat for `Reject` and assert the same.
   Alternatively merge the complete cross-branch pair and assert par payout.
3. Assert the two positions/totals are removed, the 0.2-USDC position deposits
   refund, total payout never exceeds the 1-USDC escrow, and ordinary redeem is
   rejected in `Voided`.
4. Run the closing try-state command; this scenario is runnable with the
   currently instantiated conditional ledger.

NOTE(B7): the current runtime's local `ForeignAssets` key is the verified u32
asset id while 02's frozen contract expects a `Location` key. The fixture
matches the real current metadata so the dry run can execute and keeps that
pre-existing integration gap visible.

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the scenario starts with a real Voided Vaults[1], both Alice
    branch-USDC positions, both totals, the position count/deposits, and
    the matching ForeignAssets sovereign custody
  execute:
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe48200ee1e7ffeceaefd524b3ceb4c2a199ea2d098b5f70192f96c06f38d3fbc970100000000000000"
        value: "0x40420f0000000000000000000000000040420f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040420f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000100"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe49a4ea0593d7f97323d947a42bc6c2639a3b5db7d97178fd531cb31a134a0c8ae0001000000000000000000de1e86a9a8c739864cf3cc5ec2bea59fd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"
        value: "0x40420f00000000000000000000000000"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe49a4ea0593d7f97323d947a42bc6c2639299d82ce8576883a42164f21a1e8d0580001000000000000000100de1e86a9a8c739864cf3cc5ec2bea59fd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"
        value: "0x40420f00000000000000000000000000"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe48cb2ffcc631d77c9bfaf8ae0aa59502ea3b5db7d97178fd531cb31a134a0c8ae0001000000000000000000"
        value: "0x40420f00000000000000000000000000"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe48cb2ffcc631d77c9bfaf8ae0aa59502e299d82ce8576883a42164f21a1e8d0580001000000000000000100"
        value: "0x40420f00000000000000000000000000"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe48be13a2f41000d8c61dc9a5657df6f88de1e86a9a8c739864cf3cc5ec2bea59fd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"
        value: "0x02000000"
    - storage_equals:
        key: "0x94eec1b9345db53a85e5f5b9e9532fe427b3383feb4a5abbe1f93fd3600d3ff4"
        value: "0x400d0300000000000000000000000000"
    - storage_equals:
        key: "0x30e64a56026f4b5e3c2d196283a9a17dd34371a193a751eea5883e9553457b2e484550ecc01d89e5e7bb33be1915aaef010300a10f043205e514"
        value: "0x6d6f646c626c2f6c6564677200000000000000000000000000000000000000006d6f646c626c2f6c6564677200000000000000000000000000000000000000006d6f646c626c2f6c6564677200000000000000000000000000000000000000006d6f646c626c2f6c656467720000000000000000000000000000000000000000804f120000000000000000000000000000000000000000000000000000000000102700000000000000000000000000000101000000010000000000000000"
    - storage_equals:
        key: "0x30e64a56026f4b5e3c2d196283a9a17db99d880ec681799c0cf30e8886371da9484550ecc01d89e5e7bb33be1915aaef010300a10f043205e514a517f1d9b186a939edaaf86521d62d746d6f646c626c2f6c656467720000000000000000000000000000000000000000"
        value: "0x804f12000000000000000000000000000001"
- step: 2
  claim: >-
    conditionalLedger.redeemVoid(1, Accept|Reject, BranchUsdc, 1000000)
    pays 500000 planck per branch, or the complete cross-branch pair
    merges at par
  blocked_on: >-
    needs a signed-extrinsic driver; the runner speaks read-only JSON-RPC
    and does not sign calls
- step: 3
  claim: >-
    both positions/totals are removed, the 0.2-USDC position deposits
    refund, total payout never exceeds the 1-USDC escrow, and ordinary
    redeem is rejected while Voided
  blocked_on: >-
    depends on the redeemVoid dispatches in step 2
- step: 4
  claim: >-
    the closing try-state check passes
  discharged_by: try-state
```
