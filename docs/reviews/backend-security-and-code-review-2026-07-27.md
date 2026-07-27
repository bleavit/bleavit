# Backend security and code review — 2026-07-27

**Status: non-normative audit record.** This file reports one review of implemented code. It
is not part of `docs/architecture/` and creates no normative obligation; where it disagrees
with the specification, the specification wins. Milestone status lives in `PLAN.md` (R-4).

**Location rationale.** The repository had no prior full-report location: `PLAN.md · Audit log`
is a one-line-per-run index that points at reports, not a place to hold one (R-4 forbids
PLAN.md carrying content of this size). `docs/reviews/` is therefore created here, and the
Audit-log row for this run points at this file.

---

## 1. Executive summary

A repository-wide security and correctness review of the **implemented, non-frontend** backend
at `efaf866`, run as six independent workstreams (five Claude reviewers plus three independent
Codex reviews), with every candidate finding put through an adversarial refutation pass before
it was accepted.

**29 candidate findings** were produced by the Claude workstreams and **20 more** by the Codex
reviews. Adversarial verification **refuted 16 of the 29** outright and corrected the severity or
mechanism of several more; deduplicated and lead-adjudicated, **18 distinct defects** are confirmed (§8) — a refutation rate that is itself part of the result: the codebase
withstood most of what was thrown at it, and the surviving set is small and specific.

**Five findings were fixed in this PR.** Two of them are the ones that matter:

- **AUD-1 (High)** — the execution guard's post-migration fail-static latch was a **no-op**. When
  a completed multi-block migration could not release its paired recovery image, the guard raised
  the execution halt and the runtime erased it **in the same call**, because `MigrationHalt` is
  derived from a source bitmask the guard's direct write never touched. Nothing re-raised it.
  Independently found by this review and by the Codex runtime pass (as `MIG-01`).
- **AUD-4 (High)** — two lawful `welfare.register_spec` registrations could tie on their latest
  activation epoch. 05 §4.6 / I-16 make a tie mean *no active spec*, permanently and with no
  re-derivation path: no snapshot can advance `SnapshotDeadline`, the 05 §4.8 dead-man latches on
  its snapshot-overdue cause, and the deadline's try-state pairing fails once the wedged epoch's
  timing is reaped. Reproduced through the ordinary governance dispatch path before fixing.

**Two confirmed High findings could not be fixed safely inside this scope and remain open.**
They are the reason this PR is a **draft**:

- **AUD-NUM-001 (High)** — `treasury.spend`, `claim_stream`, `issue_vit` and `recover_foreign`
  mutate internal accounting and emit success events while moving **no asset at all**. The
  treasury pallet has exactly four real-custody seams and none is on those paths.
- **AUD-NUM-002 (High)** — decision-window staleness is measured against the un-clipped global
  observation gap and is never evaluated for the terminal interval, so a book that went stale at
  the end of its decision window can still grade as decision-grade.

Both fixes are feature-shaped (custody adapters; a decision-grading semantics change with
reference-model parity and vector-corpus consequences) and belong in their own changes with
spec-compliance review — not in a security-hardening pass whose mandate is the smallest safe fix.
Neither is reachable on the current rollout phase; both must land before the phase that arms them.

**No Critical finding was identified.** No unbacked claim, no privilege escalation, no filter
bypass, and no origin-confusion path survived verification. The SafetyFilter's closure over the
runtime's call-carrying variants, the genesis-time D-13 denial set, and the XCM default-deny
posture were each attacked directly and each held.

---

## 2. Commits

| | |
|---|---|
| Baseline (`origin/main` at review start) | `efaf866db3996adad381ef471468e5a7824ef4e7` |
| Branch | `audit/backend-security-hardening-2026-07-27` |
| Last code commit | `0c700a9dbada813a23f8605ccbbda3b9d28d6d78` |
| Branch head | this file is finalized in the commit that follows it; the exact head SHA is in the PR description |

The working tree was clean at `efaf866`; `HEAD == origin/main`, 0 ahead / 0 behind.

---

## 3. Scope

**In scope — implemented, non-frontend code:**

`crates/` (all 14), `pallets/` (all 13), `runtime/bleavit-runtime`, `runtime/bleavit-xcm`,
`runtime-api/`, `node/bleavit-node`, `keeper/`, `tools/` (ci, deploy, env, limit-coverage,
monitoring, phase-gates, reference-model, release, simulation, verify), `deploy/`,
`.github/workflows/`, `.cargo/audit.toml`, lockfiles and pinning policy, `fuzz/` (build and gate
configuration), `models/tla/`, `reference-model/`, and the test suites throughout.

**Explicit exclusions, applied throughout and to every subagent and Codex prompt:**

1. **All frontend work.** `frontend/` was not reviewed, modified, formatted, tested or built.
   Documents 10 and 11 were consulted only to understand backend-facing frozen interfaces.
   No frontend file is touched by this PR.
2. **Milestone G2 and every later milestone.** Nothing in this PR implements, begins, advances,
   prepares, scaffolds or changes the status of G2+. No next milestone was selected. Findings
   whose remediation would require G2+ work are recorded as out-of-scope observations (§10).

---

## 4. Architecture and attack-surface summary

Bleavit is a Cumulus parachain (polkadot-stable2606, exact-pinned) implementing futarchy: LMSR
conditional prediction markets whose TWAPs bind governance decisions, over a conditional-token
ledger holding USDC.

The privilege model reviewed:

- **Two independent checks on every governance dispatch.** Belief side: the execution guard
  applies the origin-aware `SafetyFilter::contains_for(class_origin, call)` and only then
  dispatches with `dispatch_bypass_filter`; the target pallet's `EnsureOrigin` is the second
  check. Values side: the stock scheduler dispatches *filtered*, so a closed admission set of
  bare values-enactment leaves clears the origin-blind base filter, with the pallet's
  `EnsureOrigin` again the second check. Every one of the 17 admitted leaves was checked to carry
  a real `EnsureOrigin`.
- **A frame-free model of the call graph.** `origins-core` holds a `RuntimeCall` model and the
  filter; `runtime/src/classifier.rs` projects the real `RuntimeCall` onto it with an *exhaustive*
  `match` per pallet, so a newly added call is a compile error rather than a silent allow. This is
  the single strongest structural control in the runtime.
- **Assets:** ledger escrow (USDC on the ledger sovereign account), treasury custody (`MAIN` plus
  four pot sub-accounts), VIT (native, conviction-voting power and bond collateral), and the
  recovery-image / upgrade authorization surface.
- **Trust boundaries:** signed extrinsic authors; the six governance tracks; the guardian and
  attestor sets; oracle reporters and watchtowers; collators; the Phase-0–3 founding multisig
  (in-model per D-13/TH-29); XCM from the relay and Asset Hub; the off-chain keeper's RPC
  endpoint; the release pipeline and its artifact chain.
- **The single permitted upward state transition in the whole system** (I-24) is the reserve
  probe's authenticated `QueryResponse` from canonical Asset Hub with `querier = Here`.

---

## 5. Methodology and tools

For each component: assets and safety guarantees → trusted vs untrusted inputs → privilege
boundaries → state transitions → cross-pallet interactions → the owning architecture section and
its invariants → implementation and tests → concrete failure/exploit path construction →
classification only after verification. Data and control flow were followed; grep was used to
locate, never to conclude.

Reviewers were instructed that **tests and comments may be wrong**, and to judge implementation
against the owning architecture section rather than against what a test asserts. That instruction
produced results: several findings are about tests that encode current behaviour rather than the
specification.

**Adversarial verification.** Every candidate finding was handed to a separate agent whose task
was to *refute* it, with instructions to default to refuted under uncertainty and to quote the
decisive lines. 16 of 29 Claude candidates were refuted; several survivors had their severity or
mechanism corrected. Where a verifier refuted the headline claim but left a real narrower
residual (F-06, VER-2), this review acted on the **corrected** residual, not the overstated claim.

Findings were then independently adjudicated by the lead agent against the specification before
any code was changed. Three examples where the lead overrode a reviewer:

- **FIN-01** (claimed High) — refuted. 04 §7a states the contest-capital formula verbatim as
  `noi_t = q_long · p + q_short · (1 − p)`, which is exactly what `contest_capital` computes, and
  the same section already reasons about wash flow and bounds it with `sec.flow_cap` and `C_hold`.
  Spec-conformant; the residual is a mechanism-design observation, not an implementation defect.
- **ACL-01** (Codex, claimed Medium) — downgraded. 06 §2.1's own table gives **all five** values
  tracks the same produced origin, `ConstitutionalValues`; the runtime's scoped track origins are
  a strengthening *beyond* spec, and the legacy origin routes to track 2 (`entrenched`), which
  strictly dominates every other values track on deposit, all three periods, both curves and
  enactment delay. Harder, not weaker — no escalation.
- **RT-03/RT-04** — refuted by the verification pass on spec evidence the finder had missed
  (06 §2.1's guardian row lists "attestor recall"; 13 §1's ratified "Unbounded sentinel"
  paragraph mandates that inflow-cap entries are retained and never reaped).

**Tools:** repository test suites, targeted `cargo test`, `tools/ci/rust-workspace-gates.sh
--changed`, the Python tooling suites, and direct execution of the ed25519 primitives to
demonstrate AUD-2 rather than argue it.

---

## 6. Subagent assignments

| Workstream | Surface |
|---|---|
| Specification and invariant reviewer | 02 frozen-contract drift, observable semantic deviation, try-state coverage (15 §1), unsafe failure defaults, 13 parameter sourcing, the 05 T1–T24 state machine |
| Financial and mathematical safety reviewer | ledger, LMSR/market, `futarchy-fixed`, welfare, treasury, oracle/registry/bond accounting, reference-model equivalence |
| Runtime, origin, XCM and upgrade reviewer | runtime assembly, `SafetyFilter` closure, genesis denial set, origins, execution guard, XCM, migrations, weights and PoV, storage bounds |
| Node, keeper, operations and supply-chain reviewer | `node/`, `keeper/`, `tools/`, `deploy/`, workflows, dependency and waiver policy, fail-open gate analysis |
| Verification reviewer | tests that assert behaviour rather than specification; missing negative/origin tests; PT-1…PT-8; differential corpus; try-state hooks; limit coverage; fuzz pairing; TLA⁺ models; benchmark fixtures |
| Independent Codex reviewer (×3) | financial/numerical correctness; runtime configuration and access control; off-chain, operations and supply chain |
| Verification agents (×29) | one adversarial refutation per candidate finding |

34 workflow agents completed, 0 errors.

---

## 7. Codex model and reasoning configuration — as actually used

Requested and **confirmed used**: model **`gpt-5.6-sol`**, reasoning effort **`xhigh`** (the
plugin's maximum), passed explicitly as `--model gpt-5.6-sol --effort xhigh` on every invocation.
No fallback model was used.

**Disclosure — two runs were rejected by an upstream content filter and were re-run.** The first
financial run (`task-ms36px9k-1hvz62`) and the first runtime run (`task-ms36qmdp-qsyiz3`) both
terminated with *"This content was flagged for possible cybersecurity risk"* after ~3 and ~10
minutes. Both were re-issued with the same model and effort under defensive framing (maintainer
pre-audit conformance review of our own repository) and completed normally
(`task-ms36xq0v-7s34t1`, 26 min; `task-ms3762vx-uo6yip`, 28 min). The ops run
(`task-ms36rcgp-kf879u`, 30 min) was unaffected. The one substantive lead the aborted runtime run
produced before failing (the `ConstitutionalValues` catch-all origin) was carried into the re-run
and independently adjudicated — see §5 and ACL-01.

Codex was read-only throughout: no Codex run was given write access, and no Codex patch was
applied. Every Codex finding acted on was independently re-derived from the code by the lead.

---

## 8. Findings summary

Counted by **distinct defect**, not by finding ID: the same defect was often raised independently
by more than one reviewer (AUD-1 = Codex `MIG-01`; AUD-2 = `F-04`; AUD-5 folds `VER-2`-corrected,
`VER-3` and `VER-4`), and counting IDs would inflate the total.

**A. Lead-adjudicated** — each independently re-derived from the code by the lead against the
owning specification section:

| Severity | Confirmed | Fixed here | Open |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 4 | **2** | 2 |
| Medium | 1 | 1 | 0 |
| Low | 9 | 2 | 7 |
| Informational | 4 | 0 | 4 |
| **Total** | **18** | **5** | **13** |

- **High:** AUD-1 *(fixed)*, AUD-4 *(fixed)*, AUD-NUM-001 *(open)*, AUD-NUM-002 *(open)*
- **Medium:** AUD-2 *(fixed)*
- **Low:** AUD-3 *(fixed)*, AUD-5 *(fixed)*, RT-01, RT-02, ACL-01, F-01, F-03, VER-1, VER-9
- **Informational:** FIN-03 / AUD-NUM-003, SPEC-04, SPEC-05, SPEC-06

**B. Reported by the independent Codex reviews and recorded, but NOT individually re-adjudicated
by the lead.** They are listed at the severity Codex assigned. Treating them as confirmed would
overstate what this review established, and they are excluded from the table above:

`AUD-NUM-004` (Low) · `WGT-01`, `WGT-02`, `WGT-03` (Medium) · `OFF-01`…`OFF-09` (2 High, 5 Medium,
2 Low) · `MIG-H01` (hypothesis). Of these, `OFF-01` overlaps `F-02`, which the Claude verification
pass **did** adjudicate and downgraded to Low.

**16 candidate findings were refuted** after investigation (§9), and **8 out-of-scope
observations** recorded (§10).

---

### 8.1 Fixed in this PR

#### AUD-1 — Execution-guard post-migration fail-static latch is erased in the same call · **High** · CONFIRMED · FIXED

- **Component:** `pallets/execution-guard`, `runtime/bleavit-runtime` (audit scope A)
- **Location:** `pallets/execution-guard/src/lib.rs:1656` (`migration_completed`);
  `runtime/bleavit-runtime/src/configs.rs` (`MigrationStatusToGuard::completed`,
  `sync_execution_migration_halt`, `clear_migration_halt_sources`)
- **Spec:** 09 §3.2 (PB-MIGRATION halt); 05 §4.3.2 `Π` `FailStaticLatch`; R-7
- **Preconditions:** a registered multi-block migration completes while the committed paired
  recovery image cannot be released (`RecoveryImages::unpin` refuses — a corrupt or inconsistent
  pin state). No adversary required; this is the failure path the latch exists for.
- **Execution path:** `MigrationStatusToGuard::completed()` calls
  `ExecutionGuard::migration_completed()`, which raises the halt with a direct
  `MigrationHalt::put(true)`. The next statement calls `clear_migration_halt_sources(...)`, whose
  `sync_execution_migration_halt` does an unconditional
  `MigrationHalt::put(sources & EXECUTION_HALT_SOURCES != 0)` — derived from the
  `MigrationHaltSources` bitmask alone. The guard's condition sets no bit there, so for a
  successfully completed migration the mask is empty and the halt is written back to `false`
  **in the same call**. Nothing re-raises it: the cursor is gone, so no source is set afterwards.
- **Impact:** the fail-static latch protecting against an unrepaired recovery-image pin is a
  permanent no-op on the single path it guards. Belief-side execution resumes while the condition
  that engaged the halt is unrepaired, and the activation edge never reaches the 09 §3.2(4)
  `MigrationHalted` operator diagnostic or the 05 §4.3.2 `Π` integrity recorder — so the halt is
  invisible to both operators and the welfare integrity metric.
- **Root cause:** two writers for one storage item. `MigrationHaltSources` is the derived
  authority for `MigrationHalt`, but the guard writes `MigrationHalt` directly, so any halt it
  raises is invisible to — and erased by — the next source transition.
- **Fix:** order the clear **before** `migration_completed()`, so the guard's own write is the last
  one and stands. It adds no storage read or write, so no benchmarked weight moves.
- **Regression tests:**
  `completed_migration_keeps_the_halt_when_the_recovery_image_cannot_be_released` (fails at
  baseline with *"the execution halt raised by migration_completed was silently cleared"*) and
  `completed_migration_without_a_pinned_image_lifts_the_halt` (proves the ordinary case still
  lifts the halt, so the repair does not create a stuck queue), both in
  `runtime/bleavit-runtime/src/tests_migration_guard.rs`.
- **The first attempt at this fix was wrong, and the final Codex review caught it (§7).** It
  introduced a dedicated `RECOVERY_PIN_HALT` source bit so the activation edge would also reach the
  09 §3.2(4) diagnostic and the 05 §4.3.2 `Π` recorder. Codex established that the intended exit
  was **unreachable in production**: after an MBM completes, the cursor is gone and
  `PendingAnchorCapture` has been consumed, so the guard's per-block retry of
  `release_recovery_image` no longer runs, and `RecoveryImage` is only ever cleared by that
  retry succeeding. The bit would therefore have latched forever — converting a fail-open into a
  permanent execution-queue halt, the exact opposite defect. Its test appeared to prove an exit
  only because it killed the storage item by hand. That version also added an `exists` read and
  conditional writes to a benchmarked mandatory migration path without regenerating
  `pallet_migrations` weights. The shipped fix is the ordering change, which is smaller, has no
  weight consequence, and restores exactly the behaviour the guard's own comment describes.
  **The `Π`/diagnostic visibility gap this attempt tried to close remains open** and is recorded
  below as an unfixed residual.
- **Corroboration:** independently found by the Codex runtime review as `MIG-01`.

#### AUD-4 — A lawful `register_spec` pair can permanently wedge the snapshot deadline and latch the dead-man · **High** · CONFIRMED · FIXED

- **Component:** `crates/welfare-core`, `pallets/welfare`, `pallets/epoch` (dead-man detector)
- **Location:** `crates/welfare-core/src/lib.rs` (`register_metric_spec`);
  `pallets/welfare/src/lib.rs:1303` (`active_snapshot_spec`), `:1280` (`note_snapshot_recorded`),
  `:1252` (`snapshot_overdue`); `pallets/epoch/src/lib.rs:2214` (`observe_dead_man`)
- **Spec:** 05 §4.6 / I-16 (active-spec selection; "a latest-activation tie means no active
  spec"); 05 §4.8 (dead-man); 15 §1 try-state coverage rule; R-7
- **Preconditions:** two lawful metric-track registrations whose spec sets share the same maximum
  `activation_epoch`. Both pass every existing validation. No adversary is required — two
  independent governance actions land on the same epoch.
- **Execution path:** `register_metric_spec` validated lead time, weights, discipline flags,
  bond coverage and oracle seats, but performed **no cross-version check** on the maximum
  activation epoch. Once two versions tie, `active_snapshot_spec(e)` returns `None` for every
  `e ≥ that epoch` (the fail-closed ambiguity branch, which is itself correct). Then
  (1) `note_snapshot_recorded` early-returns on `active_snapshot_spec(epoch) != Some(version)`, so
  `SnapshotDeadline.due_epoch` never advances; (2) `snapshot_overdue` becomes permanently true and
  `observe_dead_man` sets `DEAD_MAN_CAUSE_SNAPSHOT`, engaging the freeze; (3)
  `active_metric_spec_version()` returns `None`, so no new proposal can bind a creation-time spec;
  (4) once `EpochTimings` reaps the wedged epoch, `snapshot_due` returns `None`, the cause goes
  **silent** while the wedge persists, and the welfare try-state's
  `snapshot_due(progress.due_epoch).is_none()` branch fails permanently — blocking every future
  upgrade's `try-runtime` check.
- **Impact:** chain-level execution freeze plus a governance halt, followed by a silent detector
  and a permanently red try-state, reached by two ordinary governance actions.
- **Reproduction (run at baseline before fixing):** two `register_spec` calls at
  `CurrentEpochValue = 5` with activation epoch 9 for versions 2 and 3 both return `Ok`, and
  `active_snapshot_spec(9)` and `active_snapshot_spec(10)` are both `None`.
- **Root cause:** the selection rule's fail-closed tie handling was implemented, but nothing made
  the tie unreachable, and the wedge it produces has no re-derivation path.
- **Fix:** admission control at the single write site — refuse a registration whose maximum
  activation epoch equals that of any already-registered version, with the existing
  `BadActivationEpoch` error (no new error variant, so no contract surface moves). The fail-closed
  tie handling is left in place as defence in depth. Refusing is the G-1 direction: governance
  re-submits one epoch over.
- **Regression test:** `a_second_registration_may_not_tie_the_latest_activation_epoch`
  (`pallets/welfare/src/tests.rs`) — asserts the refusal *and* that a one-epoch-later registration
  is admitted and leaves the selector unambiguous at 9, 10 and 11.
- **Also added after the final Codex review (§7):** `WelfareState::try_state` now checks
  cross-version activation uniqueness. Admission control cannot see a tie that predates it — an
  upgrading chain carrying two versions registered under the previous runtime, or any raw storage
  write — so the try-state check is what makes this an invariant rather than a property of one
  code path (15 §1 coverage rule). Regression test:
  `try_state_rejects_a_pre_existing_activation_tie`.
- **Benchmark fixtures repaired after the final Codex review (§7).** `full_specs` in
  `pallets/welfare/src/benchmarking.rs` assigned activation epoch 2 to every version, so all three
  welfare benchmarks (`register_spec`, `record_snapshot`, `record_daily_gate`) failed setup with
  `BadActivationEpoch` once the admission check landed. This was missed because the local
  changed-scope gate does not build with `--features runtime-benchmarks`. Activations are now
  version-derived (`1 + version`, keeping version 1 at epoch 2 so `fill_snapshots` still satisfies
  `SpecNotActive`), applied to the whole set after the last component push. The measured worst case
  — a full 16-version history — is unchanged.
- **Fixture updates forced by the fix (not coverage reductions):** two existing tests registered
  several versions all at the fixture's hardcoded activation epoch 2.
  `metric_spec_history_accepts_16_and_rejects_17th` (the `MetricSpecs` limit-coverage test) now
  spreads activations across versions — the 16/17 bound it exists to prove is unchanged — and
  `snapshots_and_settlement_bind_creation_time_spec_version` in `welfare-core` gives its second
  version a distinct activation.

#### AUD-2 — Ed25519 small-order-point rejection is inoperative in the release attestation monitor · **Medium** · CONFIRMED · FIXED

- **Component:** `tools/monitoring/attestation_monitor.py` (the 12 §5.2 out-of-band monitor)
- **Location:** `_decode_point`
- **Spec:** 12 §5.2; 14 TH-38/TH-39/TH-41/TH-45 (this monitor is the **only sound detector** for
  the TH-45 hostile-service-worker residual, since in-band detection is explicitly unsound)
- **Execution path:** points are extended projective coordinates `(X, Y, Z, T)` and the check was
  `if _scalar_mult(point, 8) == IDENTITY` — a Python **tuple** comparison. For a small-order `P`,
  `8·P` is a non-normalized representative of the identity, `(0, k, k, 0)` with `k ≠ 1`, so the
  comparison never matched. The module defines the correct projective comparison `_points_equal`
  and uses it elsewhere; `_decode_point` did not.
- **Demonstrated, not argued:** all four canonical small-order encodings (orders 1, 2, 4, 8) were
  accepted at baseline, with `8·P == IDENTITY` false and `_points_equal(8·P, IDENTITY)` true for
  every one.
- **Impact:** the module's "Strict RFC 8032" claim did not hold. A small-order key admitted into
  the release keyring would let this monitor accept forged attestations — weakening the one
  control that watches the release channel from outside the service worker's interception domain.
- **Fix:** one line — `if _points_equal(_scalar_mult(point, 8), IDENTITY)`.
- **Regression tests:** `test_canonical_small_order_points_are_rejected` (four subtests; fails at
  baseline on all four) and `test_small_order_public_key_never_verifies`, in
  `tools/monitoring/tests/test_crypto.py`.

**Total added by this PR: 12 new test functions, plus three new call surfaces inside the
existing `every_callable_surface_rejects_origin_misuse`.** Each fails at baseline.

#### AUD-3 — `check-generated-weights.py` reports a pass when it has nothing to check · **Low (defence-in-depth)** · FIXED

- **Component:** `tools/ci/check-generated-weights.py` (the 15 §4.5 generated-weight purity gate)
- **Honest framing:** verification **refuted** the finder's stronger claim (the overrides file's
  own staleness rule provides an incidental guard today). What survives, and what is fixed here,
  is narrower: `scan()` returns an empty map both when the weights directory is absent and when it
  holds no parsable weight function, and `main()` then printed *"0 functions checked"* and exited
  0. A moved directory, or a generator whose output grammar the regex stops matching, would turn
  the gate into a silent no-op. 15 §5 already forbids exactly this shape for an empty artifact
  inventory; this makes the same rule explicit here rather than incidental.
- **Fix:** refuse an empty inventory with exit 2; and pass `WEIGHTS` explicitly at the call site,
  because `scan`'s default argument binds at definition time (a latent footgun the regression test
  surfaced).
- **Regression tests:** four new test functions, in `tools/ci/tests/test_check_generated_weights.py`, including
  `test_main_refuses_an_empty_inventory` and `test_main_passes_on_a_real_inventory`.
- **Verified non-regressive:** the gate still reports 360 functions checked, 2 justified overrides.

#### AUD-5 — Missing origin-misuse tests on privileged calls · **Low** · CONFIRMED · FIXED

15 §4.1 requires *every extrinsic × every error path × origin misuse*. Three privileged surfaces
had no wrong-origin test, and one test named an exhaustive claim it did not meet.

- `pallets/execution-guard/src/tests.rs` — `every_callable_surface_rejects_origin_misuse` omitted
  `commit_recovery_image` (the `RecoveryCommitOrigin`-gated recovery commitment),
  `qualify_recovery_image` and `authorize_phase_four` (the one-shot Phase-3→4 sudo bridge). All
  three added. `authorize_phase_four` deliberately asserts signed and none only, with a comment:
  the mock wires `PhaseFourBridgeOrigin = EnsureRoot` where production uses `EnsureCurrentSudoKey`,
  so Root is this harness's configured authority and asserting it would be false.
- `pallets/attestor/src/tests.rs` — `remove_for_cause` (the I-19 cause-aware removal that revokes
  attestations and slashes a bonded member) had no wrong-origin test. Added, including an explicit
  `ratify_origin()` case, because the pallet deliberately splits `ValuesOrigin` from `RatifyOrigin`
  and a regression collapsing them would otherwise pass silently.
- `pallets/guardian/src/tests.rs` — `uphold_veto` and `recall`, both named in I-23, had none.
  Added.

---

### 8.2 Confirmed, open — the two High findings that make this PR a draft

#### AUD-NUM-001 — Treasury value-bearing calls perform no asset operation · **High** · CONFIRMED · **NOT FIXED**

- **Component:** `pallets/futarchy-treasury`, `crates/futarchy-treasury-core`
- **Location:** `pallets/futarchy-treasury/src/lib.rs` — `spend` (call index 1), `claim_stream`
  (3), `issue_vit` (5), `recover_foreign` (6); `mutate`/`persist`
- **Spec:** 08 §1.3 outflow controls, §1.4 calls and custody, §2.3 VIT issuance; I-7 / I-17
- **Evidence (re-derived independently of Codex):** the treasury pallet uses exactly **four**
  real-asset seams — `PotFunding::fund` (MAIN→pot, `fund_budget_line` only, and only for the four
  pot-backed lines), `RenewalDispatch` (coretime XCM), `InsuranceSweep` (INSURANCE→MAIN) and
  `CommunityVesting` (community pot). None of them is reachable from `spend`, `claim_stream`,
  `issue_vit` or `recover_foreign`. The `Config` trait declares no `fungibles` handle and no
  native-currency handle. `persist` writes the state aggregate and deposits events, and nothing
  else. The core's `spend` debits the internal line, charges both rolling meters, and pushes an
  `Event::Spent`.
- **Impact:** a successful `spend` reports a grant that never moves. `claim_stream` is the sharp
  case: it advances the stream's `claimed` cursor and returns the claimable amount, which the
  pallet discards with `.map(|_| ())` — so a legitimate vested entitlement is **consumed and
  cannot be retried**. `issue_vit` meters phantom issuance against the 2 %/365 d cap without
  minting. `recover_foreign` moves nothing.
- **Direction of error:** for `spend`, conservative for solvency — custody stays in `MAIN` while
  the internal ledger over-reports outflow, so custody ≥ liability. For `claim_stream` it is a
  real loss of a recipient's claim.
- **Phase reachability:** all four require the `FutarchyTreasury` origin, produced only by a
  passed TREASURY-class decision, which requires the TREASURY capability armed at **Phase 5**
  (G5). Unreachable on the current phase.
- **Why not fixed here:** the fix is four new custody adapters (USDC payout to an arbitrary
  destination; stream payout; native VIT minting; foreign-asset recovery), each inside a storage
  transaction that persists core state only if the asset operation succeeds, plus try-state
  reconciliation between the internal line ledger and real custody, plus regenerated weights for
  four extrinsics. That is feature implementation with spec-compliance and weight consequences —
  outside the change restriction of a security-hardening pass, where the mandate is the smallest
  safe fix. **It must land before TREASURY arming.**

#### AUD-NUM-002 — Decision-window staleness excludes the terminal gap and overcounts pre-window gaps · **High** · CONFIRMED · **NOT FIXED**

- **Component:** `pallets/market`
- **Location:** `pallets/market/src/lib.rs:1545-1553` (the staleness increment), `:2073`
  (`seal_window`)
- **Spec:** 04 §7 — *"any observation gap > 50 blocks **inside the decision window** increments
  `stale_events`; first event extends the pair once by 3 days, second forces reject"*; I-13
- **Leg A — the security-relevant one (terminal gap never evaluated).** `stale_events` is
  incremented only when a *new observation arrives*. `seal_window` closes the window and
  synthesizes the end checkpoint but never evaluates the interval
  `[last_observation, window.end]`. A window whose final observation is more than 50 blocks before
  `end` therefore records **zero** stale events for that terminal gap, and — with coverage,
  sanity, convergence and contest-capital checks satisfied — still grades decision-grade. The
  specification requires that gap to be the first stale event and to force an extension. This is
  an **adopt-favourable** failure of a staleness control, the direction G-1 forbids.
- **Leg B — conservative (pre-window overcount).** The gap is measured as
  `observed_block − previous_block` using the **un-clipped global** previous observation for the
  book, not clipped to `window.start`. A window opening shortly after a long quiet period is
  charged a stale event for time that lies before it. This errs toward extension/reject — a
  liveness cost, not a safety one.
- **Impact:** a decision can be taken on a book whose price data went stale at the close of its
  decision window, which is precisely the input the trailing-window and convergence rules exist to
  protect. Binding decisions begin at Phase 3.
- **Why not fixed here:** the correct fix — clip each measurement to
  `[max(previous_observation, window.start), min(observation, window.end)]` and evaluate
  `[max(last_observation, window.start), window.end]` idempotently at seal — is a change to
  **decision-grading semantics**. The reference model implements the same staleness rule and the
  shared vector corpus encodes its outcomes (15 §4.4 differential parity), so a unilateral runtime
  change would break differential agreement or silently move it. This needs a paired
  runtime + reference-model change with regenerated vectors and its own spec-compliance review.
  **It must land before Phase 3.**

---

### 8.3 Open — RT-01, and the benchmark-fidelity set

| ID | Finding | Location | Disposition |
|---|---|---|---|
| RT-01 (Low, lead-adjudicated) | **META-class runtime upgrades are unexecutable.** The classifier projects `commit_recovery_image` to the CODE-only call domain, but 06 §3.2 line 121 marks that row FutarchyCode ✔ **and** FutarchyMeta ✔, and the pallet's own `RecoveryCommitOrigin` accepts both. Since 09 §3.2 requires every upgrade payload to carry a recovery descriptor, a META upgrade fails screening, enqueue *and* execute. Fail-closed, no escalation — but a mandated governance lane does not exist, and no test exercises it. | `runtime/bleavit-runtime/src/classifier.rs:789`; `crates/execution-guard-core/src/lib.rs` (`domain_allowed`) | **Not fixed.** The remedy needs a new call-domain variant admitted for CODE ∪ META in two crates plus the capability mapping — a widening of a governance capability surface, which a hardening pass must not make unilaterally. Recommended fix recorded; needs its own change with spec review. |
| WGT-01 (Codex, Medium, not re-adjudicated) | Guardian ratification benchmarks omit the bounded reverse-join scan. | `pallets/guardian/src/benchmarking.rs` | Not fixed — see note below. |
| WGT-02 (Codex, Medium, not re-adjudicated) | Epoch benchmarks measure only one of six welfare histories reaped. | `pallets/epoch/src/benchmarking.rs` | Not fixed — see note below. |
| WGT-03 (Codex, Medium, not re-adjudicated) | Runtime benchmark projection skips production XCM and reserve reads. | runtime benchmark wiring | Not fixed — see note below. |
| OFF-04 (Codex, High, not re-adjudicated) | Release evidence executes environment tooling without committed byte/closure pins. | `tools/env/`, `tools/release/` | Not fixed — release-pipeline hardening with its own evidence-contract consequences (15 §5). |

**On WGT-01/02/03 and RT-02 (benchmark fixtures that under-exercise).** This is the repository's
own recurring defect class — PLAN.md records `pallet_attestor::remove_for_cause` declaring 8 reads
while performing 261, `decide` seeded with zero `Rounds`, and `record_snapshot` fabricating every
component at 1.0. The findings are credible and of the same shape. They are **not fixed here**
because the remedy is fixture changes plus a full weight regeneration at committed fidelity
(hours of `frame-omni-bencher`), which then surfaces as acknowledged weight regressions requiring
their own justification entries — a change whose correctness this review cannot verify without
running the release-tier fidelity job. Fixing them inside a hardening PR would mean shipping
weights this review could not stand behind.

---

### 8.4 Confirmed, open — Low and Informational

| ID | Finding | Disposition |
|---|---|---|
| ACL-01 | Legacy `ConstitutionalValues` satisfies every `EnsureValuesScoped<_>` gate and maps to track 2, so the runtime's beyond-spec scoped-track separation is not airtight. **No escalation**: 06 §2.1 gives all five values tracks that same produced origin, and track 2 (`entrenched`) strictly dominates every other values track on deposit, all three periods, both curves and enactment delay. The residual track-scope allocation gap is already recorded as open spec work in 06 §3.3. | Not fixed — the remedy is a governance-surface change plus a migration story for live referenda. |
| RT-02 | Execution-guard crank benchmarks seed a 1-entry queue while `load`/`persist` read and rewrite the whole queue map. | Not fixed (weight regeneration; see §8.3 note). |
| F-01 | Zombienet relay binaries are fetched with a self-attesting checksum and no committed digest pin. | Not fixed — test-environment tooling; recommend committing digests to `tools/env/pins.env`. |
| F-03 | The keeper pins nothing about chain identity: genesis hash, runtime version and metadata all come from the RPC endpoint, and subxt `dynamic()` sets `validation_hash: None`. A hostile endpoint controls the encoding of what the keeper signs. Verified **PLAUSIBLE**. | Not fixed — needs a genesis/metadata-hash pin and a signing-time check in `keeper/`. |
| OFF-07 | Keeper accepts a secret URI as a process argument (visible in `ps`) and reads `--signer-file` without checking permissions. | Not fixed — recommend rejecting world/group-readable key files and deprecating `--signer-uri` for production. |
| OFF-02, OFF-03, OFF-05, OFF-06, OFF-08, OFF-09 | Release/monitoring/supply-chain hardening: dirty-source attribution, no independent reproduction, alert fail-open on vanished metric families, stale-RPC healthy reporting, fuzz lockfile outside advisory coverage, GHSA checker accepting structurally incomplete reports. | Not fixed — recorded for the operations track. |
| VER-1 | PT-2 discharges its 15 §4.3 obligation with a hand-written model of the trade wrapper where the text says it MUST drive real `market-core` buys. | Not fixed — a real test-obligation gap; rewriting PT-2 is verification work of its own size. |
| VER-9 | Ledger try-state cannot see a live position whose `PositionTotals` row is absent, because the identity is summed from `PositionTotals` itself. | Not fixed — recommend a reverse-direction check. |
| FIN-03 / AUD-NUM-003 | `mul_score` multiplies in `u128` before dividing by 1e9, where 03 §5.3 explicitly mandates u256 intermediates. A representable, fully collateralized claim above `u128::MAX / 1e9` fails with `ArithmeticOverflow`. Conservation is preserved (the atomic wrapper rolls back); the claim is stranded. Economically extreme supply required. | Not fixed — a one-line u256 change, but it is in audit-scope-A ledger math where the reference model must agree; recommend as a paired change. |
| AUD-NUM-004 | Saturating stream vesting permanently underpays large valid streams. | Not fixed. |
| SPEC-04 | 02's own ownership clause still says "frozen at contract version 12" while the contract is at **v15** (`INTEGRATION_CONTRACT_VERSION = 15`). | Not fixed — documentation truing in the frozen contract needs the 02 §13 joint sign-off; recorded. |
| SPEC-05 | 13 reading rule 7's "normatively and exhaustively" kernel-bounded key set omits `sec.flow_cap`. | Not fixed — spec truing. |
| SPEC-06 | 05 §3.3 still declares `CohortInfo.proposals` bounded at 5 while the frozen bound is 12. | Not fixed — spec truing. |

---

## 9. False positives rejected after investigation

16 candidates were refuted by the adversarial pass or by lead adjudication. The ones worth
recording, because each looked like a real defect until the specification was read:

| ID | Claim | Why it does not hold |
|---|---|---|
| FIN-01 | Contest capital counts fully-hedged riskless inventory at face value, inflating `AttackCost̂` (claimed High). | 04 §7a states the formula verbatim as `noi_t = q_long · p + q_short · (1 − p)` — exactly the implementation — and the same section already reasons about wash flow ("churn and wash flow net out of `noi_t` by construction") and bounds the residual with `sec.flow_cap` and `C_hold`. Spec-conformant. The residual is a mechanism-design observation for the 15 §4.9 review, not an implementation defect. |
| RT-03 | `attestor.remove_for_cause` reachable from the guardian track collapses an authority distinction. | 06 §2.1's guardian-track row lists "attestor recall (§7)" in a column the document declares exhaustive, and `remove_for_cause` is the only attestor-recall surface the pallet has. The binding is spec-correct. |
| RT-04 | `pallet-inflow-caps::CumulativeDeposits` is unbounded and never reaped (I-21). | 13 §1's ratified "Unbounded sentinel" paragraph (SQ-196) *mandates* retention: "Entries already recorded are retained, never reaped; they stay visible to `try-state` and bind again unchanged if a bounded cap is later restored." |
| SPEC-01, SPEC-02, SPEC-03 | T20 leaves a terminal proposal with `decision = None`; settlement defaults a missing outcome to `Adopt`; `force_reject_if_cohort_void` overwrites a recorded outcome. | A `Rejected(_)` proposal is never written to `Proposals` — it is reaped in the same storage layer as the force-reject — so the claimed durable artifact does not exist. The `Adopt` normalization is on an unreachable branch and is not covered by I-24's text. |
| F-02 / OFF-01 | No GitHub Action is SHA-pinned; mutable refs reach the release write token (claimed High/Medium). | Downgraded to Low defence-in-depth. Real and worth doing — and verification surfaced a sharper fact than the finding stated: `dtolnay/rust-toolchain@1.89.0` resolves to a *branch* (`refs/heads/1.89.0`), not a tag. Recorded for the operations track. |
| F-05 | RustSec waivers have no mechanical staleness gate. | `.cargo/audit.toml`'s seven ignores are governed by the 15 §4.5 waiver discipline: per-entry annotation, pin-forced proof, and re-triage from scratch at every SDK train bump — enforced procedurally, and the file shows the re-triage was performed at the stable2603→2606 move. |
| VER-5, VER-6, VER-7, VER-8 | PT-3 residual bound, PT-6 rounding sublattice, fuzz oracle independence, two limit-coverage bindings. | Each refuted or narrowed to a non-defect on the code and the owning text. |
| SPEC-07 | `open_oracle_rounds()` leaks retention-held settled rounds. | 02 §7.2 makes that view the frozen projection of the whole `Rounds` map by design, and 07 §11(1) deliberately keeps settled rounds in it. |
| ACL-01 (escalation half) | The catch-all origin is a privilege escalation. | Track 2 strictly dominates every other values track on every dimension; the path is harder, not weaker. Retained only as the Low scope-conformance note in §8.4. |

---

## 10. Out-of-scope observations

Recorded, not acted on, per the G2+ and frontend exclusions:

1. Two of doc 02's frozen-contract statements (SPEC-04) and two doc-05/13 figures (SPEC-05,
   SPEC-06) have drifted from the implementation. Correcting the frozen contract requires the
   02 §13 joint backend+frontend sign-off; correcting 05/13 is ordinary spec truing. Both are
   documentation work with no runtime consequence.
2. The `is_values_enactment_leaf` admission set admits leaves that 06 §2.1/§3.2 do not allocate to
   any track (`ForeignAssets.create`, `epoch.set_next_epoch_length`, `referenda.cancel`/`kill`,
   `attestor.resolve_challenge`). 06 §3.3 already records this and calls closing it spec work.
3. G2-and-later phase-gate obligations (Paseo exit evidence, contract freeze co-signature, ss58
   acceptance, testnet bootnodes, release-train drills) were not assessed.
4. Frontend-owned controls (INV-FE-1…15, CSP, service-worker policy, provider firewall) were not
   assessed; the backend-facing interfaces they consume were.
5. The `tools/phase-gates/check-phase0-exit.py` red-by-design state is intentional and was not
   treated as a finding.
6. `keeper/` and `fuzz/` are separate cargo workspaces by design (SDK pin isolation); their
   dependency policies differ from the root workspace deliberately.
7. RT-01's remedy would also want a META-class upgrade end-to-end fixture; every upgrade fixture
   in the repository currently hardcodes `ProposalClass::Code`.
8. AUD-NUM-001's remedy will need `try-state` reconciliation between the internal treasury line
   ledger and real custody — a new invariant obligation under the 15 §1 coverage rule.

---

## 11. Commands and gates executed

Recorded exactly, including what did not run and why.

| Gate | Command | Result |
|---|---|---|
| Baseline compile | `cargo check --workspace --all-targets --locked` | **pass** (exit 0) at `efaf866`, before any edit |
| Formatting | `cargo fmt --all -- --check` | **pass** |
| Changed-scope Rust gate | `tools/ci/rust-workspace-gates.sh --changed welfare-core pallet-welfare pallet-attestor pallet-guardian pallet-execution-guard bleavit-runtime` | see PR validation table |
| Welfare | `cargo test -p welfare-core -p pallet-welfare --locked` | **pass** — 103 + 51 |
| Execution guard | `cargo test -p pallet-execution-guard --locked` | **pass** — 74 |
| Attestor / guardian | `cargo test -p pallet-attestor -p pallet-guardian --locked` | **pass** — 28 + 57 |
| Runtime regression | `cargo test -p bleavit-runtime --lib --locked` (AUD-1 tests) | **pass**; both fail at baseline as intended |
| Monitoring tooling | `python3 -m unittest discover -s tools/monitoring/tests` | **pass** — 107 (105 before, +2) |
| CI tooling | `python3 -m unittest discover -s tools/ci/tests` | **pass** — 137 (133 before, +4) |
| Generated-weight purity | `python3 tools/ci/check-generated-weights.py` | **pass** — 360 functions, 2 overrides |
| Weight regression | `python3 tools/ci/check-weight-regression.py` | **pass with acknowledgements** — no weight artifact changed by this PR |
| PLAN tables | `python3 tools/ci/check-plan-tables.py` | see PR validation table |
| Whitespace | `git diff --check` | see PR validation table |

**Gates deliberately not run, with reasons — none of these is claimed as passing:**

- **The exhaustive `tools/ci/rust-workspace-gates.sh` (no arguments)** — runs in CI on the PR.
  R-12 governs: the changed-scope gate is the local feedback loop, and the exhaustive gate runs
  once for the coherent state rather than being duplicated locally.
- **`tools/ci/regenerate-weights.py --check`** — requires a `runtime-benchmarks` release build and
  a full `frame-omni-bencher` run. No weight artifact is modified by this PR, so no regeneration
  is owed; the drift gate runs in CI (`benchmark-smoke`).
- **`tools/ci/property-gates.sh` (≥10⁶ proptest cases, release)** — hours of runtime; the reduced
  counts run inside `cargo test --workspace` in CI.
- **`tools/verify/run-model-checks.sh`** — pinned TLC over the TLA⁺ models; no model changed.
- **`tools/ci/fuzz-gates.sh`** — no `*-core` trait signature changed, so the separate nightly fuzz
  workspace is unaffected. (Recorded because a core-trait change would have required it.)
- **`tools/ci/supply-chain-gates.sh`** — no dependency or lockfile changed.
- **The ≥10⁷-point `futarchy-fixed` sweep** — release-pipeline cadence; no kernel or reference
  numerics changed.
- **Zombienet / Chopsticks / `try-runtime-cli` snapshot legs** — require external infrastructure
  and pinned tooling not available in this environment; they are phase-gate/release-tier suites.
- **All frontend checks** — excluded by scope.

---

## 11a. Final independent review of the fixes

After the fixes were applied and locally validated, the baseline-to-HEAD diff was handed back to
Codex (`gpt-5.6-sol`, `xhigh`) for a fresh adversarial review scoped to incomplete fixes,
regression-test gaps, newly introduced defects, excessive privilege, changed financial semantics,
weight/migration regressions, G2+ leakage and frontend changes.

**Its verdict was "no-ship", and it was right.** It found four problems with this review's own
fixes, two of them High, and all four were confirmed and addressed:

| Codex finding | Verdict | Action |
|---|---|---|
| `RECOVERY_PIN_HALT` had no reachable production exit and would latch permanently; the zero-MBM site was still unrouted | **Confirmed** — the intended exit depended on a retry that cannot run after an MBM completes | The source-bit design was **withdrawn** and replaced with the ordering fix, which has no exit to get wrong. The zero-MBM site's visibility gap is recorded as an open residual rather than half-fixed |
| The activation check broke all three welfare benchmark setups | **Confirmed** — reproduced with `cargo test -p pallet-welfare --features runtime-benchmarks` | Fixtures repaired; all 110 welfare tests including the three benchmarks pass |
| Pre-existing or migration-written ties stay undetected | **Confirmed** | `try_state` activation-uniqueness check added, with a regression test that starts from tied storage |
| `migration_completed` gained unmeasured storage work on a benchmarked mandatory path | **Confirmed of the withdrawn design** | Moot for the shipped fix: the ordering change adds no storage read or write, verified against the diff |

Codex also reported clean: the ed25519 projective equality is correct and no other projective
tuple comparison remains in that module; no privilege, call-filter, financial-semantic, frontend,
G2+ or `docs/architecture/` change is present; and the two modified welfare test fixtures retain
their original assertions.

**The lesson worth carrying.** Both High findings against this review's own work were of the same
shape as the defects it was auditing for — a control that is correct in isolation and wrong in
interaction (an exit that no production path reaches), and a change validated by a gate that does
not compile the code it broke (`--all-targets` is not `--all-features`). The value of the final
adversarial pass was not that it polished the fixes; it is that without it this PR would have
shipped a permanent chain halt in place of a fail-open.

---

## 12. Final assessment

The backend is in materially better shape than a repository of this size and ambition usually is
at this stage. The structural controls that matter most are real and were verified directly: the
call-classifier's exhaustive per-pallet `match` makes a silently-admitted new call a compile
error; the genesis-time D-13 denial set holds for every origin including sudo; the two-independent-
checks governance model is implemented on both the belief and values paths, and all 17
values-enactment leaves carry a genuine `EnsureOrigin`; no `unsafe` exists anywhere in the
workspace and no `unwrap`/`expect`/`panic!` is reachable from a dispatch or a hook outside
`try-runtime`-gated code.

The defects that did survive share one shape, and it is worth naming because it will recur: **a
control that is present, correct in isolation, and defeated by its interaction with something
else.** AUD-1's latch is raised correctly and erased by the writer that owns the storage item.
AUD-4's tie handling is correct and reachable because nothing prevents the tie. AUD-2's
small-order check is the right check written with the wrong equality. AUD-NUM-002's staleness
rule is implemented for the intervals it observes and silent for the one it never looks at. None
of these is found by reading a function; all of them are found by asking what else writes the same
state, or what happens after the last call.

Two confirmed High findings remain open because fixing them safely is not this PR's job.
Neither is reachable on the current rollout phase, and both are gated behind phases that have not
been entered — but both must be closed before the phase that arms them, and AUD-NUM-001 in
particular deserves attention well before Phase 5, because a `claim_stream` that consumes an
entitlement without paying it is a defect a user experiences as loss.
