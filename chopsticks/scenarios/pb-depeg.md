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

<!-- Machine-readable encoding of the steps above; the evidence runner
     executes it and refuses to name this scenario in
     bleavit.env-evidence.v1 unless every assertion ran (15 §4.7/§5; SQ-203). -->
```card-assertions
- step: 1
  claim: >-
    the scenario starts from the attested post-entry image: the real
    guardian membership, bonds, activation review, active playbook,
    allowances, and cursors
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
        value: "0x04008013030000"
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
- step: 2
  claim: >-
    only market.freeze_creation(expiry) executes: new book creation is
    rejected while existing buy/sell/crank paths stay live
  blocked_on: >-
    market.freeze_creation and its persisted expiry are absent from
    current pallet/runtime metadata
- step: 3
  claim: >-
    advancing to expiry lifts the freeze automatically and emits
    PlaybookExpired
  blocked_on: >-
    the pallet has no registered-playbook/active-hold or downstream
    effect-revert storage
```
