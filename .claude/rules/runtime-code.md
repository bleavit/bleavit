---
paths: ["pallets/**", "runtime/**", "crates/**", "node/**", "runtime-api/**"]
---

# Runtime code rules (consensus-critical Rust)

These rules bind all FRAME/runtime code. Spec citations are to `docs/architecture/`.

1. **Status-quo default (G-1).** Every error, ambiguity, overflow, or liveness failure
   resolves to REJECT/no-op. No `unwrap`, `expect`, `panic!`, indexing without bounds
   checks, or unchecked arithmetic in runtime code — use checked/saturating ops and
   return typed errors. No `unsafe` anywhere in the workspace.
2. **Determinism.** No floating point ever; all market/welfare math goes through
   `futarchy-fixed` (64.64, maker-adverse rounding — 04 §4). No wall-clock time in phase
   logic (`pallet-timestamp` is display-only — 01 §5.1). No randomness outside spec'd
   mechanisms. Rounding always against the claimant / in the maker's favor
   (03 §6.3, 04 §4, I-5, PT-3).
3. **Bounded everything (G-6, I-20, I-21).** Every storage collection is a
   `BoundedVec`/`BoundedBTreeMap` with its bound taken from 13 §4; every type derives
   `MaxEncodedLen`; every hook/loop is cursor-bounded with a defined overload behavior.
   No hooks where the spec says none (the ledger has none — 03 §10).
4. **Parameters are never hardcoded.** Kernel `K` constants come from
   `futarchy-primitives` (compile-time); every other tunable is read from
   `pallet-constitution::Params` (13 · Reading rules). A numeric literal that duplicates
   a 13-owned value is a defect, in code and in tests alike.
5. **Contract surface is frozen.** Storage/event/call/error names and SCALE shapes that
   appear in `02-integration-contract.md` must match it byte-for-byte; 02's spelling is
   canonical. Additions are append-only (02 §13).
6. **Origins are narrow (G-5, I-10).** Every extrinsic declares an explicit origin check;
   custom origins only via `pallet-origins`; no `EnsureRoot` outside the execution guard's
   two allowlisted upgrade calls; every new call gets a row in the SafetyFilter authority
   matrix (06 §3) and negative tests through the closed wrapper set.
7. **XCM isolation (I-24).** `xcm`/`pallet-xcm` types must not be imported by
   `pallet-epoch`, `pallet-welfare`, `pallet-market`, or `pallet-conditional-ledger`.
   The only XCM-adjacent oracle surface is the reserve-probe `QueryResponse` handler (07 §8).
8. **try-state is mandatory.** Every pallet implements `try-state` covering its
   machine/state invariants per the coverage rule in 15 §1; a new invariant-relevant
   storage item without a try-state check is incomplete.
9. **`no_std` discipline.** `futarchy-primitives` and `futarchy-fixed` must never gain
   `frame` dependencies (01 §5.2) — the reference model, frontend port, and auditors
   consume them standalone.
10. **Weights.** Every call, hook **and transaction extension** is benchmarked
    (`frame-benchmarking`); weight regressions > 10 % fail CI (15 §4.5). An extension
    whose generic slots this runtime substitutes (a `HandleCredit`, an
    `OnChargeTransaction`, a currency/asset adapter) MUST be benchmarked *here* and its
    `WeightInfo` bound to the generated artifact — `()` charges the upstream
    reference runtime's measurement, and the post-dispatch refund cannot correct it
    (it subtracts the same `WeightInfo` it charged).
