---
name: new-pallet
description: Scaffold a new FRAME pallet in this workspace following the project conventions — Cargo wiring, lib.rs skeleton with Config/storage/events/errors named per the frozen integration contract, mock runtime, per-extrinsic test stubs, benchmark stubs, and the mandatory try-state hook. Use when a plan-tree milestone introduces a pallet.
argument-hint: "<pallet-name, e.g. conditional-ledger>"
---

# Scaffold a FRAME pallet

## 0. Preconditions

- The workspace exists (milestone M0 ✅ in PLAN.md); `$ARGUMENTS` names the pallet
  (kebab-case, without the `pallet-` prefix). Crate name: `pallet-$ARGUMENTS`;
  directory: `pallets/$ARGUMENTS/`.
- Read the pallet's owning `docs/architecture/` document (pallet map: 01 §5.1) plus
  the pallet's rows in `02-integration-contract.md` (frozen storage/event/call names —
  02's spelling is canonical) and its invariant rows in `15 §1` (which try-state checks
  are mandatory) before generating anything.

## 1. Generate

```
pallets/<name>/
├── Cargo.toml          # workspace-inherited deps, std/try-runtime/runtime-benchmarks features
└── src/
    ├── lib.rs          # #![cfg_attr(not(feature = "std"), no_std)] pallet skeleton
    ├── mock.rs         # mock runtime with the pallet's real Config bounds from 13 §4
    ├── tests.rs        # one failing-todo test stub PER extrinsic × error path × origin misuse (15 §4.1)
    ├── benchmarking.rs # benchmark stub per call (15 §4.5)
    └── try_state.rs    # try-state hook checking this pallet's machine/state invariants (15 §1)
```

Skeleton content rules:

- `Config` items, storage items, `Event`/`Error` variants, and call signatures come
  from the owning doc — insert them as typed TODO stubs with a `// SPEC: <doc> §<n>`
  comment on each, so the implementing session has the citations in place.
- Bounds are named constants wired to `13 §4` values via the mock — never bare literals.
- All types derive `MaxEncodedLen`; collections are `Bounded*`.
- No hooks unless the owning doc specifies them (the ledger, e.g., has none — 03 §10).

## 2. Wire

- Add the crate to the workspace `members` and (when the runtime crate exists) a
  commented placeholder in the runtime's pallet list + `SafetyFilter` authority-matrix
  TODO (06 §3) so it cannot be forgotten.
- `cargo check -p pallet-<name>` must pass with the stubs in place.

## 3. Record

- PLAN.md: note the scaffold in the milestone's Session notes (the milestone itself
  stays 🔨 — scaffolding is not implementation).
- Report the generated files and every `SPEC:` citation inserted.
