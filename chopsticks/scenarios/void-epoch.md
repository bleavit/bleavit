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
