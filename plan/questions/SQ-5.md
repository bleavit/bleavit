---
id: SQ-5
title: Who writes each `PhaseFlags` bit, via which call/path and origin? 09 §5.4 gives bootstrap sudo "arming phase flags"; is a per-bit writer map wanted, and is an extrinsic intended at all post-Phase-4? (Implemented meanwhile, fix round 2: `set_phase_flag` is Root-only **and bit-scoped to the armable mask 0–4**; machinery bits 5–7 have dedicated one-bit internal setters `note_ledger_frozen`/`note_dead_man_engaged`/`note_reserve_health`, so no caller — sudo included — can fake or clear another pallet's signal.)
spec_ref: 02 §7.3; 09 §5.2/§5.4
raised: 2026-07-15 (A1 spec-reviewer)
status: resolved
resolved: 2026-07-15
batch: none
---

## Question

Who writes each `PhaseFlags` bit, via which call/path and origin? 09 §5.4 gives bootstrap sudo "arming phase flags"; is a per-bit writer map wanted, and is an extrinsic intended at all post-Phase-4? (Implemented meanwhile, fix round 2: `set_phase_flag` is Root-only **and bit-scoped to the armable mask 0–4**; machinery bits 5–7 have dedicated one-bit internal setters `note_ledger_frozen`/`note_dead_man_engaged`/`note_reserve_health`, so no caller — sudo included — can fake or clear another pallet's signal.)

## Status

**resolved 2026-07-15** (batch): writer map added to 06 §3.2 — bits 0–4 sudo (Root-only, mask-scoped call) then phase-advancement upgrades; bits 5–7 machinery-only internal setters
