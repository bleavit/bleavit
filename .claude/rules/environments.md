---
paths: ["zombienet/**", "chopsticks/**", "tools/env/**"]
---

# Test-environment rules (zombienet, chopsticks, tooling pins)

Moved out of the always-loaded `AGENTS.md` · Repository layout on 2026-08-06: it only
matters under these trees, and this file loads whenever a session touches them.
Status claims below are point-in-time — **PLAN.md is the single source of
implementation status (R-4)**, and drill results in particular move.

### `zombienet/`, `chopsticks/`, `tools/env/`

**Status:** B7 done

Test-environment definitions — release artifacts, not private fixtures (15 §4.7; 02 §11): zombienet relay+para(+AH/Coretime) topologies + the 09 §7.1 drill suite (`.zndsl` + js helpers), chopsticks forked-state scenario configs for every upgrade path and all six 06 §6.2 playbooks, pinned tooling (`tools/env/pins.env` single-homes the zombienet/chopsticks/polkadot-sdk/paseo-CSG pins) + fetch/generate scripts and the structural validator (`tools/env/validate-environments.py`, CI job `environments`). The **B7 evidence producer** executes suites against built artifacts at tag time and emits `bleavit.env-evidence.v1`; gated suites block evidence fail-closed under SQ-139/SQ-202, Chopsticks card execution is SQ-203, and the closing try-state leg is SQ-204. **G1 (2026-07-18, first real execution, V-36)**: drills 01/02/03 pass end-to-end (keeper runs as a real topology node via `zombienet/scripts/keeper-node.sh`); zndsl grammar/timeout repairs, the Paseo-CSG `WASM_BUILD_WORKSPACE_HINT` release-blocker fix, and the fast-runtime + `num_cores` relay scheduling rulings landed in `tools/env/`; post-#105 (G0/S4) merge (2026-07-20): drills **01/02/03/06 pass** — SQ-274 resolved, drill 06 stages `MigrationHalt` at genesis via the new `pallet-execution-guard` `migration_halt` field (plain spec; no production fault-injection surface); 07's `spec_version` sentinel retired but blocked on a pinned-Paseo asset-hub-runtime inherent trap; 05's staged-renewal code landed (genesis seeding + ~8 h dead-man run remain); **09 passes 6/6** via a default-off `fast-timing` compressed-epoch test runtime (SQ-128 implemented — three real 84-block epochs advanced unattended in ~29 min; two kernel floors + three registry seeds off one `kernel::FAST_DAY_BLOCKS` knob, release runtime byte-frozen). **Fast-timing extended (SQ-128) to drills 04 & 08**: `DEAD_MAN_RELAY_BLOCKS` 4,800→48, `DESCRIPTOR_LEAD_TIME_BLOCKS` 43,200→12. **G1 Phase-1 exit reached (2026-07-20, SQ-282 resolved):** the 09 §7.1 line-282 drill set passes — 01/02/03/06 + compressed 09 6/6 + **04 dead-man 18/18** + **05 coretime-under-dead-man 19/19**. SQ-282: the relay GRANDPA finalized head is not parachain-runtime-observable on stable2606 (SDK-verified), so 05 §4.6/§4.8 + 13 §2 + 14 TH-37 were re-scoped to the observable relay-parent-gap trigger (detector code already correct, no runtime-code change) and drill 04 re-pointed to a collator outage → relay-parent gap → engage+recover; drill 05 proves the D-9 coretime freeze-exemption via a probe under the engaged dead-man (genesis-seeded coretime authority/account through the existing treasury fields). **Drills 07 (Phase-3 XCM funding, line 284) and 08 (Phase-2 expedited-CODE under staged freeze, line 283) are not Phase-1 gates**; the `bleavit.env-evidence.v1` bundle is release-train (G2+, SQ-203/204). Carried forward: SQ-283 (off-chain relay-finality monitor, O5), SQ-284 (raw-`TreasuryState` polkadot-js decode quirk), SQ-233 (cross-milestone trigger feeds).

The release producer derives every chain-spec prerequisite from the selected
topology. Exact ordinary/migration spec names bind to the shipped primary Wasm;
the N10 client para and fast-timing specs are explicit separate-runtime classes,
and an unclassified `bleavit-*` spec is refused.
