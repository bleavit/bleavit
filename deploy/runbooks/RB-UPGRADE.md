---
id: RB-UPGRADE
title: Stalled migration recovery
owner_role: Release operations lead
funding_line: ops.arweave / ops.monitoring
page_immediately: true
alerts:
  - domain: Upgrades
    trigger: cursor stalled
spec_refs:
  - docs/architecture/06-governance-and-guardians.md
  - docs/architecture/09-execution-upgrades-and-rollout.md
  - docs/architecture/12-release-and-operations.md
  - docs/architecture/15-invariants-and-testing.md
---

## Purpose

This runbook is the operational face of `PB-MIGRATION`. It covers a multi-block
migration cursor that has exceeded its declared time budget or entered `Stuck`:
the affected surface must
fail-stop while block production and unaffected work continue, and recovery is a
bounded retry or a rollback implemented as a forward upgrade
([09 §2/§3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md)).

## Alerts

| Domain | Key series | Trigger |
|---|---|---|
| Upgrades | authorized hash, applied version, migration cursor | cursor stalled |

The live trigger means an active `Migrations::Cursor` has been running longer
than its budget — `now − cursor.started_at > 900` blocks (09 §3.2(d)) — or the
cursor is `Stuck`. It is a **time budget, not a progress test**, because a lawful
migration may return byte-identical cursors for hours while doing real work.
The runtime reads the SDK cursor's own `started_at`; the retired
`BleavitRuntimeMigration::ProgressMarker` is not an evidence source.

The alert does not authorize a force-set of the cursor, a storage
rewrite, or a rollback to old bytes ([12 §6.3](../../docs/architecture/12-release-and-operations.md)).

## Diagnosis

1. Record a finalized block hash, current and target `spec_version`, authorized
   code hash, migration identifier, cursor bytes, failed-step index, and the first
   block at which the cursor became active (`cursor.started_at`). Preserve raw
   SCALE as well as decoded state.
2. Read `Migrations::Cursor` and the runtime-internal
   `BleavitRuntimeMigration::{HaltSources, FailedStep}` values. Compute
   `now − cursor.started_at` and compare it against 900: that is the normative
   predicate (09 §3.2(d)). Confirm `Stuck` separately. If the stall halt is set
   while `now − started_at ≤ 900` and the cursor is not `Stuck`, preserve the raw
   state and treat the detector/signal disagreement as an invariant breach; do
   not infer progress or rewrite the cursor. Rule out a stale monitor.
3. Read `ExecutionGuard::MigrationHalt`, `PendingUpgrade`, `LastUpgradeAuthorized`
   and the relevant `ExecutionGuard::Queue` entry.
   Read `ExecutionGuard.PreMigrationAnchor`. Per 09 §3.2(2), it is captured at
   code application only when the applied image registers a multi-block migration
   cursor, and stores `(anchor_block, anchor_hash)` for the last pre-migration
   block. It is absent during authorization, absent for a zero-MBM image, and
   cleared by the migration-completion callback. If a live or halted migration
   has no anchor, preserve the raw cursor and surrounding headers and treat the
   missing cell as an invariant breach; do not reconstruct a healthy on-chain
   value by assumption
   ([09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md)).
4. Reconstruct `UpgradeAuthorized`, `UpgradeApplied`, `UpgradeAborted`, execution,
   migration, and `GuardianAction` events. Locate the first
   `MigrationHalted {cursor, failed_step}` for this halt-source activation. Treat
   those fields as the machine trigger's snapshot and compare them with a state
   proof at the event block/phase, not merely with current storage. On a failed
   migration step the handler emits while the SDK cursor is still `Active`, after
   which the SDK writes `Stuck`; on a stall, later execution in the same block may
   also advance or replace the live cursor. Those expected transitions do not make
   a different current cursor an evidence mismatch. The event is emitted once on
   the first machine-trigger halt; a later halt source does not emit it again. If
   that first event is absent, preserve the raw cursor/failed-step proof and record
   a compliance gap; absence of the event is not evidence that no halt exists.
5. Confirm halt-at-fault behavior: blocks finalize and unaffected calls remain
   usable, while the affected transaction surface, execution queue, and new
   ledger/market inflows fail-stop. Any half-migrated layout exposed to user calls
   is a separate invariant breach.
6. Classify the fault from evidence: resource-bounded overrun/transient host
   failure versus logic fault, storage-shape mismatch, or failed retry. Compare
   halted-state writes with the reconstructed anchor; do not infer the class from an error
   string alone.
7. Check release coupling. From `UpgradeAuthorized`, compare `applicable_at`, the
   covering production descriptor release, `ReleaseChannel`, and the committed
   metadata/artifact hashes. A repair or rollback-forward artifact still follows
   the descriptor pipeline and release train
   ([09 §2.2](../../docs/architecture/09-execution-upgrades-and-rollout.md),
   [12 §1](../../docs/architecture/12-release-and-operations.md)).

## Remediation

### Safe / permissionless

1. Preserve block production and unaffected services; stop automated execution,
   inflow, and migration-control submissions against the affected surface. Publish
   the cursor, failed step, reconstructed anchor, and impact boundary for operators.
2. Keep ordinary finalized reads, alerting, and release preparation live. Do not
   call `Migrations.force_set_cursor`, `force_set_active_cursor`,
   `force_onboard_mbms`, or `clear_historic`; the runtime classifier denies these
   calls and [09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md)
   forbids set-storage-class recovery.
3. Prepare a retry only for the resource-bounded classes and within the attempt
   rule owned by [09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md).
   Re-benchmark the step and run `try-runtime`/`try-state` against the halted
   snapshot before proposing continuation. The exact upstream control surface is
   still a spec `[VERIFY]`; never improvise a force call.
4. For every other class, or an exhausted retry path, prepare rollback as a
   forward CODE upgrade restoring the pre-migration-anchor semantics for the affected keys.
   Build, attest, ratify, and descriptor-cover it through the expedited lane that
   the active migration halt makes admissible.

### Privileged

1. While the verified migration trigger is active, the guardian 5-of-7 may
   activate registered `PB-MIGRATION` ([06 §6.2](../../docs/architecture/06-governance-and-guardians.md)).
   Verify the effect, not merely approvals. The current runtime returns an error
   when downstream guardian playbook effects are unavailable; in that state the
   chain is not operationally contained.
2. **`PB-MIGRATION` has no dispatchable activation** and therefore produces no
   guardian trail: its admissible call set is empty, so a fifth approval fails
   closed and the whole extrinsic reverts, recording no `PlaybookActivated`, no
   allowance consumption and no review record
   ([06 §6.2](../../docs/architecture/06-governance-and-guardians.md)). Do not
   wait for those events and do not treat their absence as an implementation
   gap. The accountability trail is the automatic `MigrationHalt` halt-source
   bridge, the first `MigrationHalted {cursor, failed_step}` event, and the raw
   state proof; capture all three.
3. Decide retry versus rollback within the deadline in [09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md);
   inaction defaults to rollback initiation. Guardians cannot install code, and
   on stable2606 they have **no in-framework retry either**: `pallet-migrations`'
   continuation controls are Root-only and filtered to the D-13 "nobody" row, so
   both retry and rollback ride the expedited-CODE lane (SQ-274).
   **⚠ Know before you plan the repair: while any `Migrations::Cursor` exists the
   chain is inherent-only.** `MultiStepMigrator::ongoing()` is `Cursor::exists()`
   and `frame-executive` then rejects every non-inherent extrinsic, so the
   expedited-CODE lane named above — and `execute(pid)`, guardian calls, and sudo
   with it — **cannot be included in a block** until the cursor is gone. SQ-309 is
   ruled but its pre-authorized inherent-applied recovery image is not yet
   implemented, so production builds prohibit registering any multi-block
   migration. A live cursor therefore indicates a non-production build or a
   bypass of that integrity lock: escalate to the guardian council and release
   lead immediately. Do not attempt an on-chain extrinsic repair that cannot be
   submitted; relay `force_set_current_code` remains break-glass only.
4. A rollback is a forward upgrade through the normal execution guard, using the
   migration-halt-gated expedited CODE lane. Full attestation, ratification,
   payload checks, and `DescriptorLeadTime` still apply; no privileged shortcut
   exists ([09 §3.1](../../docs/architecture/09-execution-upgrades-and-rollout.md)).
5. Lift the **guardian playbook freeze** only after migration completion and a
   green `try-state` run — that precondition binds the operator freeze, not the
   on-chain flag, because `try-state` never runs in production block execution
   ([09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md),
   amendment (c)). The on-chain `MigrationHalt` clears **mechanically** on
   migration completion or successful recovery-image application. Do not declare
   the incident closed because the cursor was manually removed or because a
   release was merely published.

## Escalation

This alert pages on arrival, not after triage: a stalled cursor already holds
ordinary transactions under the multi-block-migration lockdown, so the on-call
responder is paged by the alert itself
([12 §6.3](../../docs/architecture/12-release-and-operations.md);
[09 §3.2](../../docs/architecture/09-execution-upgrades-and-rollout.md)). Widen
to the Release operations lead, Infrastructure coordinator, guardian council,
and the owners of the affected pallet once the halt is confirmed. The
release team owns the covering descriptors and repair train. Guardians own no
`PB-MIGRATION` activation at all on stable2606 (step 2): their role here is to
initiate the expedited-CODE repair lane, which the halt makes admissible. The
retrospective-`ratify` review and the unratified-activation bond consequence of
[06 §5.4](../../docs/architecture/06-governance-and-guardians.md) attach to
guardian actions that actually dispatch — so they attach to that lane's guardian
steps, not to a `PB-MIGRATION` activation that cannot occur.
If descriptor coverage is consuming the lead-time margin, invoke RB-RELEASE's
descriptor-release leg; never apply code before the on-chain lead-time gate.

## References

- [09 §2 — two-phase upgrade path](../../docs/architecture/09-execution-upgrades-and-rollout.md)
- [09 §3.2(2) — the pre-migration anchor](../../docs/architecture/09-execution-upgrades-and-rollout.md)
- [09 §3.1–§3.2 — expedited lane and PB-MIGRATION](../../docs/architecture/09-execution-upgrades-and-rollout.md)
- [06 §5.4/§6.2 — guardian review and playbook scope](../../docs/architecture/06-governance-and-guardians.md)
- [12 §1/§6.3 — descriptor release coupling and alert](../../docs/architecture/12-release-and-operations.md)
- [15 §4.7 — upgrade verification](../../docs/architecture/15-invariants-and-testing.md)
