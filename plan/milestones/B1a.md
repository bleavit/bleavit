---
id: B1a
track: B
title: Runtime-level FRAME assembly — turn the B1 composition model into a real runtime: `construct_runtime!` wiring the now-FRAME Track-A pallets + the standard/system/Cumulus pallets, `frame_executive`, the signed-extension / `CheckedExtrinsic` stack, `BaseCallFilter = SafetyFilter`, the `polkadot-stable2603` SDK/Cumulus pins (01 §9), and runtime genesis. Per-pallet FRAME wrapping now lives in Track-A's DoD; this is only the runtime-level composition.
spec:
  - 01 §1/§5/§9
  - 06 §3
  - 09 §5
depends:
  - A1–A11
  - B1
status: done
---

**Done 2026-07-16.** Real Cumulus runtime: `construct_runtime!` over the 10 production pallets (A1–A7/A9/A10) + standard/system/Cumulus set; A8 (`pallet-epoch`)/A11 (`pallet-execution-guard`) hold documented `construct_runtime!` index slots (61/62) + fail-closed pending seam adapters (they are still non-FRAME core scaffolds). `frame_executive`, TxExtension stack (incl. `CheckMetadataHash`), `BaseCallFilter = SafetyFilter<BleavitSafetyClassifier>` (exhaustive `RuntimeCall` domain map = the I-8 compile-time filter-exhaustiveness), stable2603 `=` pins, genesis presets, `impl_runtime_apis!` (Core/Metadata/BlockBuilder/Aura/Session/CollectCollationInfo/GenesisBuilder/TxPayment/TryRuntime/Benchmark — **not** `FutarchyApi`, that's B2). Real release **wasm builds** (`wasm32v1-none`). Gates green (workspace fmt/clippy `-D warnings`/test · runtime 30 tests + 31 w/ try-runtime · runtime-benchmarks **wasm** build · reference-model 21/21 · doc links). **Open blocker → B4:** USDC `ForeignAssets` is keyed by `u32` id 1337 (consistent with every A2/A3/A6 pallet + mock) but 02 §7.4/§8 freeze it as XCM-`Location`-keyed (SQ-101) — re-key or amend 02 before the FE/XCM surface is consumed (B4 owns the Location↔local mapping). Gates B2–B6
