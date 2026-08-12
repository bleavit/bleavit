---
id: B1b
track: B
title: A8 runtime wiring — `Epoch: pallet_epoch = 61` + swap every fail-closed epoch-shaped seam (`PendingEpochClock`/`PendingA8Authority`/`PendingEpochHandoff`/`PendingExecutionEnqueueAuthority`/`PendingGuardianStatus`/`PendingGuardianScheduler`/`PendingReporting`/`PendingRegistryEpoch`/market `InDecisionWindow`), completing the I-9 enqueue path
spec:
  - 05 §1–§5
  - 02 §7.1
  - 06 §3
  - 09 §1
depends:
  - A8
  - A11
  - B1a
  - B6
status: done
---

Completed 2026-07-17: canonical resource keys (05 §1.4) with set-equality screening + real locks; six-track split, SeatBond holds, both-deposit fronting fix, recall + uphold_veto (T24); all five guardian powers wired (kernel playbook routines, freeze endpoints). Adversarial review 7 P1/3 P2 → 8 fixed mutation-checked, residuals SQ-233/SQ-234. Gates green V-35 on post-B11 stable2606 main. The B1b-review-era adoption-input SQs (SQ-173…SQ-175, SQ-177, SQ-180…SQ-182) stay open fail-closed with named owners (release-blocking via the manifest).
