<!-- 15 §1/§4.7; 06 §6.2. -->
# PB-DEPEG steps

1. Start `pb-depeg.yml`, inject/attest the 30-day-median depeg trigger, and have
   five of seven guardians approve the pre-registered playbook.
2. Assert only `market.freeze_creation(expiry)` executes: new book creation is
   rejected while existing market buy/sell/crank paths remain live.
3. Advance to expiry, assert automatic lift and `PlaybookExpired`, then run
   try-state.

NOTE(B7): `market.freeze_creation` and its persisted expiry are normative 06
surfaces not present in the current pallet/runtime metadata. The activation
image uses real `Members`, `MemberBonds`, `ReviewDeadlines`, `ActivePlaybooks`,
`Allowances`, and cursor storage, so `Guardian::load()` succeeds and block-number
expiry maintenance runs. Keys are `Twox128("Guardian") ++ Twox128(item)`;
`ActivePlaybook` is Compact(1)+enum+`u32(201_600)`+renewals, and the review is
Compact(1)+`ReviewRecord`, SCALE-checked against the real Rust types.

The pallet has no per-playbook allowance field, registered-playbook/active-hold
storage, or downstream effect-revert state. Its review record is real, but the
runtime review scheduler is a stub and `CurrentEpoch` stays zero until A8; this
card does not fake the missing 06 §6.2 state.
