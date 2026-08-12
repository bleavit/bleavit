---
id: B1b
track: B
title: "A8 runtime wiring — `Epoch: pallet_epoch = 61` + swap every fail-closed epoch-shaped seam (`PendingEpochClock`/`PendingA8Authority`/`PendingEpochHandoff`/`PendingExecutionEnqueueAuthority`/`PendingGuardianStatus`/`PendingGuardianScheduler`/`PendingReporting`/`PendingRegistryEpoch`/market `InDecisionWindow`), completing the I-9 enqueue path"
spec: [05 §1–§5, 02 §7.1, 06 §3, 09 §1]
depends: [A8, A11, B1a, B6]
status: done
---

Completed 2026-07-17: canonical resource keys (05 §1.4) with set-equality screening + real locks; six-track split, SeatBond holds, both-deposit fronting fix, recall + uphold_veto (T24); all five guardian powers wired (kernel playbook routines, freeze endpoints). Adversarial review 7 P1/3 P2 → 8 fixed mutation-checked, residuals SQ-233/SQ-234. Gates green V-35 on post-B11 stable2606 main. The B1b-review-era adoption-input SQs (SQ-173…SQ-175, SQ-177, SQ-180…SQ-182) stay open fail-closed with named owners (release-blocking via the manifest).

<!-- source section: | ## Milestones | -->

<!-- source track heading: | ### Track B — Runtime, node and chain | -->

<!-- source row: | B1b | A8 runtime wiring — `Epoch: pallet_epoch = 61` + swap every fail-closed epoch-shaped seam (`PendingEpochClock`/`PendingA8Authority`/`PendingEpochHandoff`/`PendingExecutionEnqueueAuthority`/`PendingGuardianStatus`/`PendingGuardianScheduler`/`PendingReporting`/`PendingRegistryEpoch`/market `InDecisionWindow`), completing the I-9 enqueue path | 05 §1–§5; 02 §7.1; 06 §3; 09 §1 | A8, A11, B1a, B6 | ✅ | Completed 2026-07-17: canonical resource keys (05 §1.4) with set-equality screening + real locks; six-track split, SeatBond holds, both-deposit fronting fix, recall + uphold_veto (T24); all five guardian powers wired (kernel playbook routines, freeze endpoints). Adversarial review 7 P1/3 P2 → 8 fixed mutation-checked, residuals SQ-233/SQ-234. Gates green V-35 on post-B11 stable2606 main. The B1b-review-era adoption-input SQs (SQ-173…SQ-175, SQ-177, SQ-180…SQ-182) stay open fail-closed with named owners (release-blocking via the manifest). | -->

<!-- source track narrative -->

Doc-09 WBS delta rows map here and to Track A: E15→B2/B8 · E16→A2 · E17→A3 · E18→A6 ·
E19→A5 · E20→A10/B6 · E21→B4 · E22→A11/B1. (E1–E14 definitions live in git history —
superseded `BACKEND_PLAN.md` §26; their scope is covered by Tracks M/A/B.)

<!-- end source track narrative -->
