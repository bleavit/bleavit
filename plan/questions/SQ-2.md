---
id: SQ-2
title: 02 §7.2 pins `ComponentValues` as `map (MetricId, EpochId) → SettledComponent` (no version), but 07 §2(4) runs the reporting game per `(component, epoch, frozen spec version)` with one settlement per version across a MetricSpec activation boundary — the pair key cannot represent two per-version settled values. `pallet-oracle` (PR #30 follow-up) now keys rounds/settled values by the triple; the 02 contract row needs a resolution at the B2 mapping (append a versioned map or key change — requires the joint backend+frontend sign-off and a contract-version bump per 02 §13). **The same B2 amendment batch also carries three more 02 reconciliations surfaced by the #46 Codex review (2026-07-15)** — (a) the 02 §9 intake-row erratum (binding target for `intake.max_per_account` is `params()` + K-bound metadata constants, not a "≤ 4" metadata constant — SQ-23); (b) splitting 02 §9's combined `epoch.length`/`epoch.slots`/phase-offset-fractions row so the fractions bind via metadata constants only (13 §3.1 resolution, SQ-24); (c) adding the `pallet-attestor` storage/view shape to 02 §7 (referenced by 01 §5.1 and 06 §7; read by the FE on the CODE/META execute path, SQ-26) — so the contract version bumps once.
spec_ref: 02 §7.2; 07 §2(4)
raised: 2026-07-14
status: resolved
resolved: 2026-07-15
batch: none
---

## Question

02 §7.2 pins `ComponentValues` as `map (MetricId, EpochId) → SettledComponent` (no version), but 07 §2(4) runs the reporting game per `(component, epoch, frozen spec version)` with one settlement per version across a MetricSpec activation boundary — the pair key cannot represent two per-version settled values. `pallet-oracle` (PR #30 follow-up) now keys rounds/settled values by the triple; the 02 contract row needs a resolution at the B2 mapping (append a versioned map or key change — requires the joint backend+frontend sign-off and a contract-version bump per 02 §13). **The same B2 amendment batch also carries three more 02 reconciliations surfaced by the #46 Codex review (2026-07-15)** — (a) the 02 §9 intake-row erratum (binding target for `intake.max_per_account` is `params()` + K-bound metadata constants, not a "≤ 4" metadata constant — SQ-23); (b) splitting 02 §9's combined `epoch.length`/`epoch.slots`/phase-offset-fractions row so the fractions bind via metadata constants only (13 §3.1 resolution, SQ-24); (c) adding the `pallet-attestor` storage/view shape to 02 §7 (referenced by 01 §5.1 and 06 §7; read by the FE on the CODE/META execute path, SQ-26) — so the contract version bumps once.

## Status

**oracle portion resolved 2026-07-15 (contract v3, see [SQ-58]);** the remaining three batch items — (a) intake-row erratum (SQ-23), (b) phase-offset row split (SQ-24), (c) `pallet-attestor` 02 §7 row (SQ-26) — still ride a **later** bump when their surfaces are next touched. The A5 → B2 circular dependency forced the oracle key early; since pre-genesis bumps are free, "bump once" gives way to "bump per unblocked milestone" (this one was v2→v3).
