---
id: SQ-7
title: What call implements "entrenched-floor tighten" and 13 rule 2's META bounds-amendment — is `constitution.amend_registry` the vehicle for both, and does the "registry" include the capability table? (Neither `amend_registry` nor any bounds-amendment path exists in code yet.)
spec_ref: 06 §2.1/§2.4; 13 rule 2
raised: 2026-07-15 (A1 spec-reviewer)
status: resolved
resolved: 2026-07-15
batch: none
---

## Question

What call implements "entrenched-floor tighten" and 13 rule 2's META bounds-amendment — is `constitution.amend_registry` the vehicle for both, and does the "registry" include the capability table? (Neither `amend_registry` nor any bounds-amendment path exists in code yet.)

## Status

**resolved 2026-07-15** (batch): `amend_registry` implemented — bounds/Δ/cooldown only, never value/class/key-set; kernel-bounded rows genesis-fixed; meta-bounds per 13 rule 7; origins FutarchyMeta | ConstitutionalValues (06 §2.1 + rule 2 harmonized); capability table stays under `set_capability`
