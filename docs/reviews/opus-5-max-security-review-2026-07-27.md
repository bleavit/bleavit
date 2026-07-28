# Opus 5 Max security review — 2026-07-27

**Status: non-normative audit record.** This file reports one review of implemented code. It is
not part of `docs/architecture/` and creates no normative obligation; where it disagrees with the
specification, the specification wins. Milestone status lives in `PLAN.md` (R-4).

**Relationship to the prior report.** `docs/reviews/backend-security-and-code-review-2026-07-27.md`
reviewed the backend at `efaf866` and its fixes were merged as `8a95ef4`. This review takes
`8a95ef4` — i.e. the post-fix tree, including that report's own changes — as its baseline, and
covers the **whole repository**, not only the backend. Findings the prior report already fixed are
excluded by construction; its two remaining open items were re-checked and are noted in §7.

---

## 1. Commits

| | |
|---|---|
| Reviewed tree (`origin/main` tip) | `8a95ef4c7f75fce2090898d134e7a1bffb99ff99` |
| Prior-report baseline | `efaf866db3996adad381ef471468e5a7824ef4e7` |
| Review date | 2026-07-27 |

All `file:line` references are valid at `8a95ef4`.

---

## 2. Executive summary

**12 findings confirmed: 5 High, 7 Medium.** No Critical.

The five High findings split into two classes. Three are **permanent, unrecoverable chain
wedges** with no on-chain governance exit — the welfare snapshot capacity bound, the attestor
registry bound, and the Phase-3→4 terminal-recovery lane. In each case the verification pass
enumerated every clearing path, every guardian power, every values-track call, and the base call
filter's treatment of `system::set_storage`/`kill_storage`/`kill_prefix`/`set_code` and of
`pallet_sudo::sudo`, and found no exit; the only escape is relay-level
`paras.forceSetCurrentCode`, which is external to this chain. Two of the three are reachable by a
**single ordinary extrinsic from any funded account**; the third needs no attacker at all and
fires through the intended upgrade procedure.

The other two High findings are integrity failures in controls that exist and are believed to
work: the published chain spec can carry a `codeSubstitutes` entry that redirects runtime
execution while leaving the `:code`↔`runtime.wasm` binding green, and the guardian rerun — the
designed defence against TWAP manipulation — re-certifies the manipulated price at zero marginal
cost because doubling the LMSR depth never refreshes the cached quote the TWAP reads.

The recurring shape across the Medium set is worth naming, because it is one shape and not seven:
**a control that derives its verdict from the artifact it is auditing.** The weight-drift gate
reads "is this function constant-weight?" out of a doc comment in the file under audit
(MAX-11); the Phase-0 economic gate scores a class `0.000000` when the class has no evidence at
all, and does not export the denominator that would reveal it (MAX-12); the chain-spec validator
checks fifteen genesis fields and not the Root key (MAX-06); the keeper builds and signs every
call from metadata supplied by the node it is asking (MAX-07). Each is individually modest. The
pattern is the finding.

**29 of 41 candidates were refuted.** That refutation rate is part of the result and is reported
in §7 rather than discarded: the audit passes produced several confident-looking High findings
that did not survive contact with the code — most sharply, a genuinely forgeable XOR-fold hash
behind a permissionless extrinsic that is unreachable because its gate has no production writer.

---

## 3. Scope and method

**Scope.** The entire repository at `8a95ef4`: ~101k lines of non-test Rust (13 pallets, 14
frame-free cores, the Cumulus runtime, the XCM layer, the keeper, the fuzz workspace) and ~42k
lines of Python tooling (release publication, monitoring, CI gates, reference model, economic
simulation), plus the workflows, deploy assets and shell gate scripts. `frontend/` is a scaffold
with no source and was not reviewed.

**Method.** Two stages.

1. **Eight parallel audit agents**, partitioned by subsystem and each given the owning spec
   sections, the threat model (14) and the invariants (15): ledger + treasury + inflow-caps;
   execution guard + constitution + guardian + origins; market + oracle + numerics kernel;
   welfare + epoch + registry + attestor; runtime + XCM + node + runtime-api; keeper + fuzz +
   binary-fetch tooling; release + monitoring + deploy; CI workflows + gate scripts + reference
   model + simulation. Output: **41 candidate findings**.
2. **23 independent verification agents**, one per candidate or per tight cluster, each
   instructed to re-derive the finding from source rather than trust the reporter, to hunt for
   the compensating control the reporter missed, and to adjudicate the exclusion boundaries
   (denial of service, hardening, test-only files, trusted CLI/env values) explicitly rather than
   by assumption. Findings below verifier confidence 8/10 were dropped.

Where a claim rested on polkadot-sdk behaviour, verifiers read the pinned crate sources
(`frame-executive 48.0.0`, `pallet-migrations 19.0.0`, `pallet-assets 52.0.0`, `pallet-xcm 29.0.0`,
`sc-chain-spec 51.0.0`, `sc-service 0.60.0`, `subxt 0.50.2`, `frame-decode 0.17.2`) rather than
reasoning from the API surface. Several findings turned on exactly that, in both directions.

**Classification note.** Pure denial of service is out of scope. Three findings (MAX-01, MAX-02,
MAX-03) sit near that boundary and were adjudicated in scope on the grounds that they produce
**permanent, irreversible loss of the system's capacity to govern and repair itself, with user
collateral locked and no in-protocol recovery** — destruction of assets rather than service
disruption. Each verifier was asked to argue the opposite case; each concluded in scope, and the
reasoning is preserved in the individual entries. A reader who prefers the stricter reading should
re-rate those three as availability, not discard them.

---

## 4. Findings — High

### MAX-01 (High) — permanent chain wedge via snapshot-slot exhaustion

**`pallets/welfare/src/lib.rs:1085`** · verified 9/10 · `logic_flaw`

`record_snapshot` is permissionless (`ensure_signed`) and the core (`crates/welfare-core/src/lib.rs:824-832`)
validates only that the named MetricSpec version is *activated* by the epoch — never that it is
the epoch's **active** version, which is what `note_snapshot_recorded` requires before it will
advance `SnapshotDeadline`. So `(epoch, version)` pairs multiply. But capacity counts **records**
(`MAX_SNAPSHOTS = 20`, `crates/welfare-core/src/lib.rs:34`) while eviction is by **epoch age**:
the prune cutoff is `current − 19` and `prune_epoch_roll` (`pallets/welfare/src/lib.rs:1493-1497`)
removes only epochs strictly below it, two per call. Steady state is 19 records with exactly one
spare slot — doc 05 §4.6 states this verbatim ("This retains 19 snapshots and leaves exactly one
free slot for the epoch's own record") — while 05 §3.3 mandates up to **2 concurrent frozen
versions**. That is 21 records inside a 20-record bound, and the defect is visible in the spec's
own derivation: 13 §252 applies the ×2 version multiplicity to `MAX_ROUNDS`, and it was never
applied to `MAX_SNAPSHOTS`.

**Exploit.** Once a second spec version has activated — ordinary governance, mandated by 05 §3.3 —
epoch `A+1` needs both `(A+1, V_old)` (for the in-flight cohort frozen at the old version, per
I-16) and `(A+1, V_new)`, with one slot free. Any funded account submits the `V_old` record first;
it can be batched atomically with `Epoch::tick`. The keeper's active-version record then fails
`TooManySnapshots`. `SnapshotDeadline.due_epoch` never advances; after
`DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS` (57,600 ≈ 4 days, well inside the ≥14-day production epoch, so
no epoch roll intervenes) `snapshot_overdue` latches and escapes the pause suppression, which
requires `due_epoch >= current`; `observe_dead_man` engages the freeze; `sync_phase`
(`crates/epoch-core/src/lib.rs:647-656`) returns early while armed, freezing the epoch clock,
hence the prune cutoff, hence the slot, hence the cause. `dead_man_recovery_ready` is never
reached. `submit`/`qualify`/`decide`/`open_markets`/`settle_cohort` are all refused, open cohorts
never settle and their positions are permanently unredeemable, and the execution queue is frozen
so the CODE upgrade that would repair it cannot be enacted.

**No exit.** Verified exhaustively: `Constitution::set_phase_flag` is mask-limited to bits 0–4 and
its own doc comment states bit 6 is unreachable "even [by] sudo"; guardian powers are all
subtractive; `system::{set_code, set_storage, kill_storage, kill_prefix}` are `denied()` for every
origin (`runtime/bleavit-runtime/src/classifier.rs:277-284`); `authorize_upgrade` is
`InternalRoot`, for which `allowed_for` returns false for every origin. 05 §4.8 (SQ-254) says it
outright: such a cause would be one "no crank can clear … (no origin can clear the flag)".

**Reachability narrowing, stated honestly.** Every valid spec set must contain at least one
attested A-pillar component, and `is_expected_spec_version` only opens oracle games for versions a
live cohort froze — so stale-version records are not constructible in arbitrary steady state. The
attack window is the ~18-epoch shadow of a MetricSpec activation boundary. This does not weaken
the finding: inside that window the *legitimate* demand is 21 records against 20 capacity, so the
attacker's extrinsic is a record the protocol itself needs, merely submitted in the wrong order.
The benign ordering degrades to an unwritable cohort snapshot, recoverable via PB-ORACLE-VOID; one
extrinsic converts that recoverable degradation into the unrecoverable brick.

**Not a re-report of AUD-4.** AUD-4 fixed an activation-epoch *tie* (two versions, same activation
⇒ no active spec). This is the *capacity* bound under two lawfully distinct activations, which the
AUD-4 admission control permits and must permit.

**Fix.** Bind `spec_version` to the epoch's admissible set — `active_snapshot_spec(epoch)` plus the
versions frozen by cohorts whose measurement window contains `epoch`. `pallet-epoch` already
exposes exactly this seam as `frozen_spec_versions(epoch)`, and `pallets/registry/src/lib.rs:753`
already uses it against precisely this attack shape (`SpecVersionMismatch`). Independently, make
capacity and eviction agree: size `MAX_SNAPSHOTS` at `retention_epochs × MAX_CONCURRENT_FROZEN_VERSIONS + 1`
as `MAX_ROUNDS` already is, or reserve capacity for the deadline-advancing active-version record.

---

### MAX-02 (High) — one attestor permanently destroys the chain's upgrade capability

**`pallets/attestor/src/lib.rs:369`** · verified 9/10 · `logic_flaw` / `authz_integrity`

Neither `attest` nor `attestor_core::attest` (`crates/attestor-core/src/lib.rs:364-406`) checks
that `pid` names a real proposal; the only uniqueness constraint is the
`(pid, artifact_hash, attestor)` triple, and `ProposalId` is a bare `u64`. `Attestations` is a
single **global** `BoundedVec` capped at `MAX_ATTESTATIONS = 256` (`pallets/attestor/src/lib.rs:61`) —
not per proposal, not per attestor — and it is a Rust `const`, so governance cannot raise it. The
only removal path in the entire tree is `reap_attestation`, gated on `is_terminal(attestation.pid)`,
whose runtime oracle is `Proposals::get(pid).is_some_and(...)` (`runtime/bleavit-runtime/src/configs.rs:7433`) —
permanently `false` for a pid that was never a proposal. Grep-verified: the vector is mutated in
exactly two places, `push` (`attestor-core:398`) and `remove` (`attestor-core:661`). No migration,
no `on_idle`, no hook; the pallet's `hooks` block contains only a `try_state`.

**Exploit.** One of ≤16 seated attestors submits 256 `attest(pid = u64::MAX, artifact_hash = i, …)`
extrinsics, varying only the hash. Cost: 256 ordinary fees. From that block on every `attest`
fails `TooManyAttestations`, so `has_quorum` can never be satisfied for any new artifact. Quorum
gates the upgrade at four independent points and all four then fail: `epoch-core:2058`
(`decide` → `Reject(AttestationMissing)`), `execution-guard:1831` (queue admission), `:1978`
(execute-time re-check), and `:2317` (`commit_recovery_image` — so the B16 terminal-recovery lane
dies with it). A runtime upgrade is itself a CODE proposal, so the chain cannot ship its own fix.

**Sudo does not help.** `pallet_sudo::sudo` is recursed by the classifier
(`runtime/bleavit-runtime/src/classifier.rs:476-483`) and validated under the same origin, so
FRAME's `dispatch_bypass_filter` inside `pallet_sudo::sudo` is never reached; `sudo_as` is denied
outright. The Phase-4 profile has no Sudo pallet at all.

**Correction to the original candidate.** "The bond is never at risk" overstates: records are
challengeable for 72 h and a ratify-track adverse resolution slashes 50 %. It does not save the
conclusion — each challenge costs 12,500 VIT plus a referendum, two losses eject without freeing a
single slot, and after `remove_for_cause` the attacker's bond is *permanently locked* rather than
returned. Correct framing: the attacker forfeits a frozen 25,000 VIT bond to permanently destroy
the chain's upgrade capability.

**It also fires with no attacker.** `settle_cohort` sets `Settled` and removes the proposal in the
same call (`crates/epoch-core/src/lib.rs:1793-1808`), so once a cohort settles, every *legitimate*
attestation naming that pid is permanently un-reapable. At ≥2 attestations per CODE/META proposal,
roughly 128 settled proposals reach the same terminal state through normal operation. See MAX-09,
which shares this root cause.

**Fix.** Reject `attest` for a `pid` with no `Proposals` entry (extend the
`AttestorProposalStatus` seam with an existence predicate); make the reap oracle **total** by
treating a missing proposal as terminal — `is_none_or`, which the execution guard's twin at
`configs.rs:8022` already uses; and bound `Attestations` per proposal rather than globally.

---

### MAX-03 (High) — the Phase-3→4 fail-safe recovery lane provably cannot fire

**`runtime/bleavit-runtime/src/migrations.rs:1199`** · verified 9/10 · `logic_flaw` (failed fail-safe)

`PhaseFourTransition` is deliberately fail-static: on refusal `with_storage_layer` rolls back and
the Phase-3 flags, sudo key and `OnlyInherents` lock survive, with terminal recovery named as the
repair. That repair cannot execute. Five steps, each verified against pinned sources:

1. `frame-executive-48.0.0/src/lib.rs:580-592` runs `(COnRuntimeUpgrade, SingleBlockMigrations,
   AllPalletsWithSystem)` in that order, so `PhaseFourTransition` runs **before**
   `pallet_migrations::on_runtime_upgrade`. `PhaseTransitionLock` was written the previous block
   (`configs.rs:9223`), outside the rolled-back storage layer, and survives.
2. `pallet-migrations-19.0.0/src/lib.rs:738-765` — `onboard_new_mbms` writes an `Active` cursor
   **unconditionally** whenever `T::Migrations::len() > 0`; the `Historic` skip is later, at
   `:843`, inside `exec_migration`. The phase-four primary profile always registers one
   (`configs.rs:1090-1091`).
3. `RecoveryAwareMigrations::step()` (`configs.rs:824`) refuses to service the SDK migrator while
   `PhaseTransitionLock` is set, so that cursor never advances. After
   `kernel::MIGRATION_STALL_BLOCKS` (900 ≈ 1.5 h) `track_migration_progress` raises
   `MIGRATION_STALL_HALT`.
4. `recovery_trigger()` (`configs.rs:8863-8889`) — the `PhaseTransition` arm at `:8878` requires
   `Cursor == None` and is therefore **structurally unreachable** once a cursor was auto-onboarded.
   (This is stronger than "arm ordering": both arms match the same scrutinee.) The cursor branch
   runs and writes `RetiredMigrationCursor` (`:8940`).
5. `TerminalRecoveryTransition` enters its `PhaseTransitionLock` branch and hard-refuses because a
   retired cursor now exists — `Err("terminal recovery has conflicting phase and MBM causes")`.
   The `else` branch is unreachable and would fail anyway (`repair_retired_mbm` requires ledger
   version 0).

`complete_terminal_recovery_state()` never runs, so `RecoveryLockdown` and `PhaseTransitionLock`
stay set, `RecoveryAwareMigrations::ongoing()` stays true, and `frame_executive::extrinsic_mode()`
(`:607-613`) returns `OnlyInherents` forever. Neither flag has a dispatchable writer (exhaustively
grepped), retry is double-locked (`schedule_committed_recovery_image` early-returns at
`configs.rs:8926` on either flag), and the standard FRAME escape hatch does not apply:
`frame-system-48.0.0` has no `ProvideInherent`, so `apply_authorized_upgrade` is not an inherent
and is rejected under `OnlyInherents`.

**Triggers — no adversary required.** (a) The image applies while spendable NAV is below the
08 §4.1 PARAM floor, so `TreasuryPhaseArmingGate::ensure_armable(Param)` refuses — the exact SQ-383
condition the gate was added for. (b) Any machinery bit is set in `PhaseFlags`:
`source_state_exact` (`migrations.rs:1023-1028`) demands `SHADOW_MODE | SUDO_PRESENT` **exactly**,
and `DEAD_MAN_ENGAGED` is set automatically from the mandatory parachain inherent on a
relay-parent gap and is an explicit latch released only at a full-epoch boundary, while
`LEDGER_FROZEN` flips once a guardian playbook is authorized. The runtime's own tests
(`tests_migration_guard.rs:257-275`) already assert that each bit breaks exactness.

**Aggravating: a ≥72 h TOCTOU window with a permissionless trigger.** `exact_phase_three()` is
checked only at authorization; `PendingUpgrade.applicable_at` is `now + DESCRIPTOR_LEAD_TIME_BLOCKS`
(43,200 blocks). `apply_authorized_upgrade` is `ensure_signed` — anyone may submit it — and
re-checks only `applicable_at`, hash and spec version, never `PhaseFlags`. So the doomed upgrade
lands unattended, permissionlessly, precisely during the relay or collator disturbance that set
the bit. The correlation is adverse, not neutral.

**Spec deviation.** Doc 09 §3.2 puts both causes in one lane — "retires the exact cursor **when one
exists**" (line 198), "a successful terminal repair clears **the cursor/transition cause**"
(line 212) — and nowhere declares them mutually exclusive. The exclusivity exists only in
`migrations.rs:1199-1205`. This is an R-1 deviation, not spec-mandated behaviour, and no PLAN.md
row records it.

**Corroboration that the path was never driven end to end.** `tests_b15_recovery.rs:323-394` is
gated `cfg(all(recovery, phase-four))` — where `Migrations = ()` — hand-kills
`RetiredMigrationCursor` at `:353` and hand-sets `PhaseTransitionLock` at `:357`, constructing
exactly the state the phase-four primary cannot reach.

**Fix.** Any one closes it: suppress SDK onboarding (or kill the freshly-onboarded cursor) while
`PhaseTransitionLock` is set; or have `recovery_trigger` prefer the phase-transition cause when the
lock is set; or have `TerminalRecoveryTransition` service both causes in sequence, which is what
09 §3.2 describes. Add an integration test that drives a genuinely failed `PhaseFourTransition`
through to terminal recovery instead of seeding the post-state.

---

### MAX-04 (High) — `codeSubstitutes` rides the published chain spec unchecked

**`tools/deploy/validate-chain-spec.py:717`** · verified 9/10 · `supply_chain`

`main()` (`:714-754`) asserts values only for keys it names and never rejects unknown top-level
keys. `sc-chain-spec-51.0.0/src/chain_spec.rs:311-316` declares
`#[serde(default)] code_substitutes: BTreeMap<String, Bytes>` — JSON key `codeSubstitutes`, from
`#[serde(rename_all = "camelCase")]` — inside `ClientSpec`, which `ChainSpecJsonContainer`
(`:589-593`) flattens **alongside** `genesis`, with `deny_unknown_fields` deliberately not applied
(`:286`). It is exposed at `:712` and consumed by `sc-service-0.60.0/src/builder.rs:250-252` into
`ClientConfig.wasm_runtime_substitutes`; `code_provider.rs:133-138` then selects the substitute
over the on-chain code, logging only at `debug!`. The Bleavit node reaches that path
(`node/bleavit-node/src/main.rs` → `polkadot-omni-node-lib-0.18.0/src/common/spec.rs:246` →
`builder.rs:250`).

Because it is not genesis state, `tools/release/assemble-release.py:196-207` cannot see it: the
`:code`↔`runtime.wasm` binding hashes only `genesis.runtimeGenesis.code` / `genesis.raw.top["0x3a636f6465"]`.
`grep -rn codeSubstitutes` over the repository returns nothing.

**The asymmetry is what makes this a bypass rather than a gap.** Swapping the genesis `:code`
is caught as a *corruption* that fails assembly even under `--allow-missing`; also swapping
`runtime.wasm` is caught by the reproducible build and `build-info.json`. Adding
`codeSubstitutes` reaches the same end state — the node executes attacker WASM — while leaving
every one of those controls green, because it touches neither artifact.

**Exploit.** Add `"codeSubstitutes": {"1": "0x<attacker wasm>"}` to the published spec. The
validator prints OK; assembly content-addresses and publishes the file. Genesis state is
unchanged, so the **genesis hash is unchanged** and the poisoned node joins the same chain and
peers normally — nothing on the network distinguishes it.

**What the attacker actually gains, precisely.** Not canonical state corruption: parachain
transitions are validated by relay validators running the registered PVF, so a divergent collator
produces candidates that fail validation. The prize is **arbitrary control of the runtime-API
answers served by that node**. This project's frontend contract is the frozen 11-method
`FutarchyApi` over `state_call` (02 §3), and the ops exporters consume runtime APIs the same way —
and unlike storage reads, `state_call` results are not state-proof-verifiable. A poisoned
RPC/archive node returns attacker-chosen market prices, decision outcomes, treasury state and
telemetry while the underlying chain is honest. For a futarchy system whose value rests on reported
market state, that is the whole game. Plus collator-level censorship and authoring control.
Persistence is bounded — the substitute is keyed by `spec_version` and stops applying at the next
upgrade — and effective against the sudo-less `phase-four` profile too.

**Nothing else catches it.** There is no release signing in CI (`tools/release/README.md:103`:
CI holds no minisign, Arweave or ArNS keys); the attestation monitor covers the *frontend* Arweave
bundle, a different artifact set; and production specs are hand-assembled from
`deploy/genesis/allocations.template.json` with ceremony outputs and injected bootnodes, so there is
no byte-for-byte reproducibility reference to diff. This validator is the only automated gate
between a hand-assembled production spec and node operators, and `deploy/runbooks/RB-BOOTNODE.md:52-56`
tells operators to run it against "the exact candidate or released artifact".

**Fix.** Reject unknown top-level keys against an explicit allowlist of the `ClientSpec` fields the
project legitimately ships, and hard-fail on any non-empty `codeSubstitutes`. An allowlist rather
than a denylist, because `sc-chain-spec` deliberately does not `deny_unknown_fields`. The same
omission leaves `forkBlocks`, `badBlocks` and `telemetryEndpoints` unchecked.

---

### MAX-05 (High) — the guardian rerun re-certifies the manipulated price at zero marginal cost

**`pallets/market/src/lib.rs:1256`** · verified 8/10 · `price_manipulation`

`seed_rerun_branch_pair` (`:1256-1261`) and `seed_rerun` (`:1298-1303`) double `book.b` in place.
Since `p_L = σ((q_L − q_S)/b)`, that mechanically moves the true quote toward 0.5 — the entire
point of the 2× rerun depth. But `MarketBook::last_quote_1e9` is written in exactly two places,
both at the tail of `market_core::buy_book`/`sell_book` (`crates/market-core/src/lib.rs:1026`,
`:1113`), and nothing recomputes it when `b` changes. `observe_book` (`:1602`) reads that cached
scalar rather than recomputing from `(q_long, q_short, b)`.

That the omission is a defect rather than a design choice is structural: `price_1e9` and
`price_1e9_quantities` (`crates/market-core/src/lib.rs:1684`, `:1687`) are **private** to
`market-core` with no `pub` re-export — a repo-wide grep finds no external caller. The pallet has
no API with which to refresh the quote. The `b`-doubling was added on the pallet side without the
kernel-side support it needs.

`reopen_for_rerun` (`pallets/market/src/lib.rs:1115`) then sets
`last_observation_1e9 = last_quote_1e9`, so the κ-slew clamp is a provable fixed point
(`capped = prev.clamp(low, high) == prev` when `old == prev`), and `close_spot` is read from the
same field — so the convergence check `|close_spot − TWAP| ≤ 0.05` compares the stale value against
itself.

**Exploit.** A manipulator walks the ACCEPT decision book 0.50 → 0.60 during the original window.
A rerun is triggered — the designed defence — doubling `b` so the same `q` should price at
σ(logit(0.60)/2) = 0.5505. The manipulator simply does not trade the reopened book, and neither
does anyone else with conviction, because `quote()` recomputes correctly so the quoted price is
right. `crank_observe` is permissionless and rebated as `DecisionCritical`; because
`reopen_for_rerun` preserves `q_long`/`q_short`, `accrue_contest` keeps crediting the preserved
open interest. Coverage, convergence, contest and the staleness checks all pass with **zero
trades**, and every observation across the 72 h window records 0.600. The rerun grades
decision-grade at P̄ = 0.600 instead of 0.5505 — a **4.95 pp error against the rerun-regime hurdle
of δ + 1 pp = 4.75 pp** for TREASURY/PARAM. The manipulated price is re-certified for free and the
2× POL the treasury committed buys nothing.

**Corrections to the original candidate.** (i) The hurdle is 4.75 pp, not 3.75 pp — a rerun runs
under the 05 §5.4 δ+1 pp regime; the conclusion survives. (ii) Scope is the **T13** delay-once →
keeper-scheduled rerun only; the T25 `force_rerun` path deliberately does not seed or double,
correctly matching 06 §5.3. (iii) "Zero cost" needs a precondition: `contest_ok` requires
time-weighted open interest ≥ `dec.v_min`, which a lone manipulator cannot supply — the attack
free-rides on other traders' preserved positions, so it grades only on a genuinely active book,
which is exactly the book a guardian would rerun. (iv) "Nothing self-corrects" is too strong: the
first trade of any size refreshes the quote, after which κ slews the series to truth in ~18
intervals (~36 min); the full error requires an essentially untraded rerun, and partial trading
yields a proportional error. (v) In the rerun's favour: `dec.extension = dec.window`, so the graded
window begins exactly at the reopen block — there is no warm-up in which trading could correct the
anchor before measurement starts.

**No compensating control.** try-state asserts only `last_quote_1e9 <= PRICE_ONE_1E9`; there is no
`last_quote == price(q, b)` consistency check anywhere. The reference model's `observe()` takes the
quote as a caller-supplied parameter and models no rerun or `b` mutation at all (repo-wide grep for
"rerun" in `reference-model/src` returns nothing), so the differential corpus structurally cannot
catch it. The sole rerun test asserts `book.b == B*2` and idempotence, and nothing about the quote.
Notably, the terminal-gap staleness check added by the prior audit (AUD-NUM-002) carries a comment
naming this exact shape — "`close_spot` taken from the same stale quote the TWAP already carries —
so the convergence check could not see it either … an adopt-favourable failure of a staleness
control (G-1)".

**Fix.** Export a `pub` price helper from `market-core` and recompute `last_quote_1e9` from the
post-doubling `(q_long, q_short, b)` in both seed functions. Leave `reopen_for_rerun`'s anchor
alone — it is the correct κ anchor once the quote is right. Add a try-state assertion that
`last_quote_1e9 == price(q_long, q_short, b)` for every non-terminal book, which closes the class
permanently.

---

## 5. Findings — Medium

### MAX-06 (Medium) — the chain-spec release gate never validates the genesis Root key

**`tools/deploy/validate-chain-spec.py:441`** · verified 8/10 · `verification_bypass`

The validator reads exactly five genesis-patch sections — `foreignAssets` (`:279`), `balances`
(`:363`, `:484`), `parachainInfo` (`:415`), `futarchyTreasury` (`:442`), `vesting` (`:549`) — with
no unknown-key rejection. `patch["sudo"]` is never validated, and no other tool validates it:
`tools/release/runtime_profiles.py:226-232` asserts only that the *pallet* is in metadata, never
the key's value. `contains_todo()` (`:192-199`) matches the literal substring `"TODO"`, so a
well-formed SS58 passes. `constitution.phaseFlags` — whose `SUDO_PRESENT` bit `genesis.rs:23-27`
says MUST be set — is likewise unread.

Production ships Sudo, confirmed four ways: `tools/release/runtime-profiles.json:54`
`"release_default": "bootstrap"` with `sudo_in_metadata: true`; `runtime/bleavit-runtime/Cargo.toml`
`default = ["std", "bootstrap"]`; `runtime/bleavit-runtime/src/lib.rs:256` `Sudo: pallet_sudo = 28`;
`genesis.rs:247-257` inserts `SudoConfig { key: Some(root) }`. And by design — doc 09 §322 puts
**mainnet launch at Phase 3, "markets real … sudo present"**, with the sudo-less `phase-four`
profile reached only by the later transition. There is no production genesis preset: `get_preset`
serves only `development` and `local_testnet`, and `deploy/chain-specs/README.md` has operators
hand-build the patch from `deploy/genesis/allocations.template.json` — which contains **no `sudo`
seat at all**, unlike the coretime ops seats that SQ-264 forced to be explicit `"TODO"` entries
precisely because "fail-closed here is also silent".

**Exploit.** An attacker who influences the genesis patch at release-prep or the launch ceremony
sets `"sudo": {"key": "<attacker SS58>"}`. `validate-chain-spec.py --profile polkadot` prints OK,
`assemble-release.py:879` records no gap, the spec is published. `set_code`/`set_storage` are
filtered even for sudo (D-13), but `authorize_upgrade`/`apply_authorized_upgrade` is Root-reachable
during bootstrap, and doc 14 TH-29 states the residual plainly: *"sudo can still upgrade the
runtime and thereby do anything."* Loss during Phase 3 is bounded by `phase3.tvl_cap` /
`phase3.deposit_cap`, not by the call filter.

**Why this is a control failure, not missing hardening.** This file's sole purpose is to be the
gate; its own comments state its threat model as "a release spec that hands an external key
control of protocol collateral"; and the project has already adjudicated the identical omission —
the `foreignAssets` `owner` field — as **P1** in milestone B14. A gate that validates the asset
owner, the pot addresses, the total supply and the coretime seats but not the Root key has a hole
in the highest-privilege field inside its own declared scope.

Medium rather than High because no untrusted input reaches the validator: the adversary
precondition is release-prep or ceremony access, the same access that authors the balances the gate
*does* check, so this is a four-eyes/tamper-detection control whose failure is a defence-in-depth
gap. The `polkadot` environment is currently `live: false`.

**Fix.** For `paseo`/`polkadot`, require `patch["sudo"]["key"]` present, SS58-valid and pinned to a
committed founding-multisig address the way `PROTOCOL_POTS` pins the pots; require
`constitution.phaseFlags == SHADOW_MODE|SUDO_PRESENT` for a bootstrap launch spec; add a
`"sudo_key": "TODO"` seat to the allocation template so the existing `contains_todo` scan enforces
filling it; and add an allowlist rejecting unknown genesis-patch sections — `collatorSelection`,
`session` and `executionGuard` are unchecked today as well.

---

### MAX-07 (Medium) — the keeper builds and signs every call from unvalidated node-supplied metadata

**`keeper/bleavit-keeper/src/submit.rs:171`** (client construction: `keeper/bleavit-keeper/src/main.rs:69`) · verified 8/10 · `unauthorized_signing`

The keeper holds a funded signing key and derives every byte it signs from the node it is talking
to. `OnlineClient::<PolkadotConfig>::from_url` uses `PolkadotConfig::default()`, whose
`genesis_hash` is `None` (`subxt-0.50.2/src/config/substrate.rs:40-46`), so
`from_backend_with_config` falls back to `backend.genesis_hash().await` — the node's own answer
(`client/online_client.rs:164-171`). Subxt exposes `SubstrateConfigBuilder::set_genesis_hash`; the
keeper never calls it, and a grep over `keeper/` finds no genesis, spec-version or metadata-hash
check anywhere. Metadata comes from the same node (`snapshot.rs:270`), every call is built with
`dynamic::tx`, whose payload carries `validation_hash: None` (`transactions/payload.rs:82-95`), and
capability detection is by **name** only (`snapshot.rs:294-350`). The runtime carries
`frame_metadata_hash_extension::CheckMetadataHash` — the RFC-78 control built for exactly this —
but subxt 0.50.2 always encodes it as `Disabled` (`config/transaction_extensions.rs:129-149`) and
the runtime accepts `Disabled` (`frame-metadata-hash-extension/src/lib.rs:152`), so **every keeper
signature waives it**.

The obvious defence does not exist either: the signed **extension set and order are not fixed by
`PolkadotConfig`**. `frame-decode-0.17.2/src/methods/extrinsic_encoder.rs:1188-1247` iterates the
node-supplied metadata's declared `extension_ids` in metadata order; the static tuple is only a
name-keyed lookup table, and unknown names resolve to empty or default-`0u8` encodings.

**Exploit — same-chain, which is sharper than cross-chain replay.** A compromised third-party RPC
provider keeps the *real* Bleavit genesis, spec version, transaction version, mortality anchor and
nonce, so the extrinsic is unambiguously valid on Bleavit, and forges only the call shape: metadata
declaring pallet `"Epoch"` at `Balances`' pallet index and call `"tick"` at `transfer_allow_death`'s
call index, with its `pids` field typed as a tuple whose SCALE encoding is
`MultiAddress::Id(attacker) ++ Compact(amount)`. It also serves the proposal storage the planner
reads, so it controls the argument *values* as well as the declared types. `scale-value-0.18.2`
encodes an unnamed composite field-by-field, so the bytes land exactly, and `SafetyFilter` does not
object — `runtime/bleavit-runtime/src/classifier.rs:303-308` classifies `transfer_allow_death` as
`leaf(CallDomain::Public)`. One constraint the original candidate missed: `planner.rs:150-151`
sorts and dedups `pids`, so the attacker grinds a keypair whose public key reads as eight ascending
little-endian `u32` words — p ≈ 1/8! ≈ 1/40,320, seconds of work. A speed bump, not a defence.

**Trust boundary.** This is not "someone who controls the config". `node_urls` (trusted, precedent)
legitimately names a third party; the data that party serves is untrusted network input. Doc 14
puts *"run … RPC endpoints"* explicitly in the adversary model, doc 01 §4.2 provisions ≥4 public
RPC operators as a role **distinct** from keeper operators, `keeper/README.md:60` documents
third-party providers, and `main.rs:59-60` rotates the endpoint index on every connection attempt,
so one hostile provider among four is reached in normal rotation. Nor is it a hardening nit: both
controls ship and are unused, and the project already mandates the equivalent for its other client
(10 §90 "genesis hash == pinned", `WrongChain`, "no override"; TH-46 counts on the wallet
metadata-hash check). The only component with a funded automated signing key implements neither.

Medium because the keeper account is a hot fee wallet holding no origin, no bond and no protocol
funds (`keeper/README.md:15`: "The service is not trusted by the protocol"). Blast radius is one
operator's operational float plus its VIT conviction weight — real theft from a real external
party, no protocol-solvency impact.

**Fix.** Pinning the genesis hash alone does **not** fix this — the forgery already uses the real
genesis hash; that only kills the unnecessary cross-chain variant. The load-bearing fixes are
metadata integrity: verify metadata against a pinned hash or enable RFC-78, or validate each call's
`pallet.call_hash()` against pinned values before signing (subxt's `StaticPayload::new_static`
path), plus asserting expected `spec_version`/`transaction_version`. Note `PolkadotConfigBuilder`
does not expose `set_genesis_hash`; only `SubstrateConfigBuilder` does, and switching changes
`Address` to `MultiAddress<AccountId32, u32>`, which encodes identically for the `Id` variant.

---

### MAX-08 (Medium) — cross-version gate-breach injection settles gate markets falsely

**`pallets/welfare/src/lib.rs:1126`** · verified 8/10 · `metric_manipulation`

`record_daily_gate` is permissionless (`ensure_signed` at `:1132`) and the core
(`crates/welfare-core/src/lib.rs:890-893`) accepts any *activated* version, then computes
`S_daily`/`C_daily` from **that version's** component set and weights while writing into flags keyed
by **epoch alone**, OR-merged and never cleared (`:903`, `:915-916`).

The divergence is real and is the load-bearing point: `metric_components`
(`runtime/bleavit-runtime/src/configs.rs:5944-6046`) supplies version-independent *values* from raw
runtime counters, but `compute_daily_gates` (`welfare-core:1530-1550`) aggregates `S_daily` as a
`min` over that version's `Pillar::S` set — on which `register_metric_spec` imposes **no** weight
constraint at all — and `C_daily` as a weighted geometric mean whose renormalization denominator is
that version's on-chain weight share. Two lawfully registered versions therefore produce different
daily verdicts from identical chain state, which is why a new version gets registered in the first
place. Superseded versions are never retired (`prune_before` retires snapshots and gate flags,
never specs), so the surface is permanent once a second version exists.

`Pallet::active_snapshot_spec(epoch)` — the canonical I-16 / 05 §4.6 selector — exists in the same
file, is applied to snapshot-deadline progress (`:1285`) and to cohort qualification, and is not
applied here.

**Exploit.** With `V_old` and `V_new` both activated, an attacker holding gate-YES positions records
a single favourable day under whichever version yields the lower value. Doc 05 §4.7 states
*"Partial coverage is deliberately left unspecified… One recorded day per measurement epoch
therefore satisfies the rule"*, and the merge is monotone OR — so no race must be won, no honest
keeper suppressed, and one extrinsic is permanent. 05 §4.7 makes `GateBreachFlags` the **sole**
settlement source for gate markets, and `gate_window_outcomes` takes no `spec_version` — so every
cohort whose measurement window contains that epoch settles "breached", including cohorts frozen at
the other version, violating I-16's creation-time-version binding for a money-settling input.
`redeem_gate_impl` (`crates/conditional-ledger-core/src/lib.rs:919-946`) pays the gate-YES side.
The `GateBreachRecorded` event carries no `spec_version`, so the recording is not even
attributable on-chain. 08 §6.3 makes a recording that sets a new breach flag rebate-eligible, so
the attack can be fee-subsidized. Secondary: it makes `gate_window_sampled(epoch)` true, defeating
the SQ-79 fail-static refusal that protects a genuinely unsampled window. The same flag also arms
the guardian `suspend_on_gate` power.

**Correction.** "ε-floors" is not a lever: `register_metric_spec` enforces
`spec.epsilon_floor == EPSILON_PILLAR`, uniform across versions. The levers are the unconstrained
`S` component set and the free `C_onchain` weight distribution.

Medium because it is gated behind a second registered spec version, which has not yet occurred.

**Fix.** Require `spec_version == active_snapshot_spec(epoch)` before projecting components —
one comparison, using a selector that already exists in the same file — and/or key gate flags by
`(epoch, spec_version)`, since gate settlement is per-cohort and must follow the cohort's frozen
version.

---

### MAX-09 (Medium) — attestor liability bonds are permanently unreleasable

**`runtime/bleavit-runtime/src/configs.rs:7433`** · verified 9/10 · `fund_locking`

`is_terminal` is `Proposals::get(pid).is_some_and(...)` — a **transient** predicate, not a monotone
one. Terminal proposals are never retained: `checked_state` (`pallets/epoch/src/lib.rs:3133-3149`)
excludes `Cancelled | Settled | Rejected(_) | Expired`, `persist` is a full re-sync that removes
every `Proposals` key and re-inserts only the live set (`:2974`, `:2984`), and
`epoch_core::settle_cohort` deletes members outright (`crates/epoch-core/src/lib.rs:1808`).
Intersecting with the accepted state set leaves exactly `{Executed, Measuring}` — so for a proposal
that never executes (the common case: most CODE/META proposals lose the market decision) the reap
window **never opens at all**. Nothing cranks it: `reap_attestation` appears nowhere under
`keeper/`, and the pallet's hooks block contains only a `try_state`. The adjacent implementation of
the same-named predicate for the execution guard (`configs.rs:8022`) correctly uses `is_none_or`;
the defect is a one-word asymmetry between two adjacent impls.

**Consequence.** `reap_attestation` is the only bond-release path for an account already in
`Liabilities`: `set_members`' releases skip retained accounts (`pallets/attestor/src/lib.rs:349-351`)
and refuse to re-seat them (`Error::LiabilityExists`), `remove_for_cause`'s release is unreachable
for them (membership and liability are disjoint by construction), and `:485`/`:493` are challenge
bonds only. Worse, release requires `still_present == false` (`crates/attestor-core/src/lib.rs:665-670`) —
**every** record and revocation by that account gone — so a single unreapable record on a rejected
proposal strands the bond regardless of the others. And `remove_for_cause` (`:594`) unconditionally
pushes a liability while `revoke_records` (`:606-621`) pushes a revocation for every record whose
proposal has not executed, i.e. exactly the permanently-unreapable set. **Routine cause-removal is
therefore a near-guaranteed permanent bond lock**, not the narrow 72 h rotation race the original
candidate described. Up to 16 × 25,000 VIT held forever, releasable only by a runtime upgrade
carrying a migration. Doc 06 §406 states the violated intent: *"releases the liability hold when
that was the last retained record."*

**Corroboration that the production path was never exercised.** The benchmark helper
`configs.rs:10256-10268` injects a `ProposalState::Settled` row directly into `pallet_epoch::Proposals` —
a state the epoch pallet's own `persist` can never leave there — with the comment "an unseeded chain
fails `reap_attestation` at its precondition and the benchmark measures nothing". The only positive
reap test uses a mock oracle that ignores `pid` entirely; the only runtime-level reap test is
negative.

**Scoped down from the original candidate.** The companion claim — that unreaped records leak
`Attestations` slots monotonically toward exhaustion — is technically correct but is the excluded
resource-leak class on its own; it is reported here only as a consequence of the same root cause,
and its severe form is MAX-02.

**Fix.** Change `configs.rs:7433` to `is_none_or` so a pruned proposal reads as terminal, matching
the guard's twin, or stamp a durable terminal latch onto the `Attestation` row at
execution/settlement. Add a bond-release fallback for a `Liabilities` row whose records are all
past their challenge deadline.

---

### MAX-10 (Medium) — `open_stream` on a pot-backed budget line permanently strands real USDC

**`crates/futarchy-treasury-core/src/lib.rs:783`** (cancel leg `:851`) · verified 8/10 · `fund_locking`

Four budget lines have dedicated real-USDC custody pots rather than MAIN — `Keeper`, `Oracle`,
`Rewards`, `OpsCollators` (`pallets/futarchy-treasury/src/lib.rs:214-219`). `fund_budget_line`
keeps line and pot exactly in step: it debits `main_usdc`, credits the line, **and** moves the same
real USDC MAIN → pot (`:986-997`, a real `ForeignAssets` transfer under `Preservation::Preserve`).
Those pots are keyless sub-accounts whose only spend path is `RebatePayout::pay`, reachable only
from `do_keeper_rebate` / `do_proposer_reward` / `pay_collator_compensation`, each of which first
requires a line balance via `debitable_line`.

`open_stream` accepts any `BudgetLine` and debits it with **no custody leg** — and, unlike
`spend`/`claim_stream`/`issue_vit`/`recover_foreign`, with no `ensure_outflow_custody` guard.
`cancel_stream` then credits the remainder to `main_usdc` (`:841-851`), again with no custody leg.
The try-state drift alarm (`pallets/futarchy-treasury/src/lib.rs:2169-2194`) is **one-directional**:
`line > pot` errors, `pot > line` passes silently.

Doc 08 §1.4 states the correct behaviour explicitly — *"`open_stream` funds the stream from `line`
and reverts its remainder **there** on cancellation"* — while the implementation follows the older
§1.3 sentence, which the pallet doc comment at `:1075` cites by name.

**Failure path — two ordinary TREASURY decisions, no malice.** `fund_budget_line(Rewards, X)` moves
X real USDC into the REWARDS pot. `open_stream(line = Rewards, total = X)` zeroes the line with no
custody move, so `do_proposer_reward` can now pay nothing. `cancel_stream(id)` credits
`main_usdc += X` while the physical USDC stays in the pot. X is permanently unreachable: re-funding
moves *fresh* MAIN USDC into the pot, so the residual never shrinks and real MAIN falls further
behind `main_usdc`; no ordinary extrinsic recovers it (`recover_foreign` rejects `AssetKind::Usdc`,
`sweep_insurance` is INSURANCE→MAIN only, `ForeignAssetsForceOrigin = EnsureNever`, and the USDC
admin is itself a keyless pallet account). Recovery requires a CODE-class runtime upgrade with a
migration.

**Precondition the original candidate omitted:** `open_stream` requires
`total > trs.stream_threshold (1 %) × NAV` and `debitable_line` requires the line to hold ≥ `total`,
so the pot-backed line must hold more than 1 % of NAV. Reachable — a pre-funded keeper or rewards
buffer — but it narrows the accident surface materially.

**Scope correction:** no NAV overstatement and no unbacked claim is created — accounting main+lines
still equals real MAIN+pots, so the aggregate is right. The damage is stranding plus a silent
MAIN accounting/custody split that becomes a mis-payment surface once the A9 fungibles wiring lands.
Not a re-report of AUD-NUM-001, which deliberately scoped these two calls out on the premise that
they move no asset — a premise that is false for pot-backed lines, because the debit target is a
pot-backed bucket.

**Fix.** Reject the four pot-backed lines in `open_stream` with a dedicated error, or implement
08 §1.4 literally by reverting a cancelled remainder to the originating line with a pot-aware
source for the claim leg. Independently, make the drift check bidirectional for the pot-backed set
so any divergence is loud.

---

### MAX-11 (Medium) — a weight file's own doc comment demotes its drift failure to advisory

**`tools/ci/regenerate-weights.py:636`** · verified 8/10 · `gate_bypass`

`has_components = bool(before.ranges or after.ranges)` selects `comparison.hard` vs
`comparison.advisory`, and `before` is the **committed file under audit**. `before.ranges` is
populated exclusively from free text: `regenerate-weights.py` imports `parse_weight_file` from
`check-weight-regression.py`, where `RANGE_RE` (`:92-95`) matches a `///` line reading
``The range of component `n` is `[lo, hi]`.`` scanned over
`documentation = impl_body[preceding_end : function.start()]` (`:283`, `:288-298`). There is no
structured or generator-provided channel. The entire `benchmark-smoke` design rests on
constant-weight functions being hard-gated at any fidelity — and *whether a function is
constant-weight* is read from a comment in the artifact being checked.

The range cross-check at `:607-611` that should catch a fabricated component is evaded by a
degenerate `[0, 0]`: `lo` is `0` for the declared range, `hi` is `0` for a component the fresh file
lacks, so `lo == hi` and no drift is recorded; `worst_case_totals` then adds `slope × high = 0 × 0`,
so the totals are undisturbed too.

**Exploit.** A PR understates `pallet_attestor::remove_for_cause` at 8 storage reads while it
performs 261 — the literal SQ-490 defect this gate exists for — and adds one `///` line declaring a
`[0, 0]` range on a function that takes no arguments. The 8→261 drift moves from HARD to ADVISORY
and `failed` becomes `False`. `check-weight-regression.py` cannot see it (a decrease; the gate is
growth-only, and it diffs committed-vs-committed so it sees a regeneration and never the absence of
one). `check-generated-weights.py` cannot see it (doc comments fall outside `FN_RE`'s body capture,
and `GENERATED_CONSTRUCTS`' first pattern consumes comments anyway).

**A second, simpler bypass.** `matches` is pure text equality on the file's own `STEPS`/`REPEAT`
header (`:587-589`), and a grep of `tools/ci/` confirms **nothing anywhere pins a committed header
to the canonical 50×20**. Changing `REPEAT: '20'` to `'21'` makes fidelity match at no run,
demoting *every* component-bearing function to advisory — including in the release-blocking
`release-fidelity-weights` job that `publish` depends on. One character disables a release gate.

`ci.yml` runs on `pull_request` including forks, so the gate's input is contributor-controlled and
its green verdict is what a reviewer relies on. The diff is a single `///` line inside sixty
visually identical ones.

**Honest impact bound.** The terminal impact of an understated weight is availability — doc 14
TH-32 says so ("Underweighted call overfills blocks" → "block production degradation"), plus a spam
discount on the underpriced call. That would ordinarily be excluded as DoS. It is reported because
the *substance* is different: a verification control derives its own pass/fail decision from an
attacker-writable field inside the artifact it is verifying — the same defect class as a signature
checker that reads the expected digest out of the file being checked — and the mechanism is generic,
suppressing the storage comparison for that function entirely.

**Correction:** the "fires accidentally on a stale range" claim does not hold. A stale
*non-degenerate* range is caught (`lo=100`, `hi=0` → hard drift). Only a degenerate `[0, 0]` slips,
and none exists in the tree today. This is a forgery bug, not a drift bug.

**Fix.** `:636` → `has_components = bool(after.ranges)`; `after` is the tool's own regeneration
output, and the legitimate "committed had a component, fresh lost it" case is already hard-failed
by the range cross-check, so nothing is lost. Pin the canonical committed fidelity and fail rather
than downgrade on mismatch. In `check-weight-regression.py:142-151`, reject a declared range that
binds no slope and no function parameter.

---

### MAX-12 (Medium) — the Phase-0 economic gate scores a vacuous `0.000000` on zero evidence

**`simulation/src/bleavit_simulation/evidence.py:74`** (helper at `:56-59`) · verified 8/10 · `gate_bypass`

`_rate(0, 0)` returns `"0.000000"`, and `_check_metric_row` (`:62-83`) enforces
`decidable_false <= decidable` and rate-vs-count agreement but **never requires `decidable > 0`**.
`decidable_harm` is `harmful and abs(true_effect) >= delta` (`engine.py:161-162`) — strictly
decreasing in δ, the very parameter this gate exists to calibrate. A class whose δ has been raised
until nothing clears it records `decidable_harm: 0` ⇒ rate `0.000000` ⇒ `class_gate` True ⇒
`normative_violations` empty ⇒ `designation: "published"`, `violations: []`. The consumer cannot
recover the truth: `tools/simulation/export-sim-calibration.py:142-164` exports only the rate, never
the counts, so `tools/phase-gates/check-phase0-exit.py:1098-1119` is structurally unable to
distinguish `0/742` from `0/0`.

The hazard was known: `calibration.py:115` / `evidence.py:119` filter `decidable_harm > 0` out of
the strata-level distribution-weighted aggregate — the only non-vacuity guard in the codebase — and
it is applied to the reported-but-non-normative statistic while the normative per-class gate has
none.

**This fires accidentally, with no file edited.** `reference-model/src/bleavit_reference_model/treasury.py:38-43`
documents the calibration procedure verbatim: the floors were "raised from the pre-calibration
0.015/0.025/0.040/0.060 so that every class's decidable-harm false-pass rate is < 1 % …
TREASURY/CODE/META took a uniform 1.5x; PARAM took 2.5x", while
`simulation/src/bleavit_simulation/proposals.py:27-40` freezes the effect strata at the *original*
scale. The committed artifact already shows three of PARAM's four bands at `decidable: 0` scoring a
perfect `0.000000` on zero evidence, with the class denominator cut from 1,255 harmful to 168
(13.4 %). Had PARAM taken **3.0×** rather than 2.5× — the same knob, one step further along the
documented procedure — the last band empties, the class scores `0.000000`, `designation` is
`published`, and the Phase-0 exit gate reports `sim-false-pass: pass` for a class where the
simulation measured nothing. Doc 15 §4.9 requires the rate to be *measured* per class; nothing
grants a vacuous pass.

Medium because the counts *are* in the committed artifact for a reviewer who looks,
`check-phase0-exit.py` is deliberately not wired into any workflow (AGENTS.md: "deliberately not a
per-commit gate"), and 09 §7.1 layers a META decision and values ratification on top of the machine
gate. The exposure is that the machine gate reports a clean pass where it should report
"insufficient evidence", and every automated consumer downstream is blind to the difference.

**Fix.** Require `decidable > 0` in `_check_metric_row` — one line — and export `decidable_harm` /
`decidable_harm_false_pass_count` in `bleavit.sim-calibration.v1` so `criterion_sim_false_pass` can
enforce a minimum denominator independently. Cheap adjacent hardening surfaced by the same review:
`artifact_outcome_digest_root` is written by `export-sim-calibration.py:220` and **read by nothing**
in the entire repository — the evidence carries a binding token to the calibration artifact that no
consumer verifies.

---

## 6. Verified below the reporting threshold

Two candidates were verified TRUE POSITIVE but at confidence 7/10, below this review's cutoff.
Recorded because the underlying defects are real and cheap to close.

| Id | Location | Why it fell short |
|---|---|---|
| MAX-S1 | `tools/deploy/validate-chain-spec.py:331` | Non-USDC `foreignAssets.accounts` rows `continue` before the unbacked-issuance check, so an arbitrary genesis DOT endowment passes the gate (the file's own comment at `:102-104` claims both assets "are gated identically" — true for `assets`, false for `accounts`), and `pallet-assets-52.0.0/src/lib.rs:565` really mints it. **The exit path is currently closed**: `pallet-xcm-29.0.0/src/transfer_assets_validation.rs:47-105` rejects any reserve transfer of the network-native asset, so the fabricated balance is inert. That guard is documented in its own header as *"a temporary patch in preparation for the Asset Hub Migration … will be removed after the migration"*, and the repo has no awareness of the dependency. Becomes a High the moment the SDK pin advances past AHM. Fix: apply the exhaustiveness rule per declared asset, not only to USDC |
| MAX-S2 | `tools/env/run-evidence.py:484` | `validate_artifact_binding` binds exactly two chain specs, but release-tier drill `06-pb-migration` boots `bleavit-drill-migration.json`, which appears nowhere in the file — and `validate_live_runtime_code` is never called for zombienet suites. The emitted `bleavit.env-evidence.v1` then asserts the 09 §3.2 PB-MIGRATION path was exercised on the release runtime without having verified it. Mitigated in practice because `release.yml:199` regenerates all specs from the same `$wasm` immediately before the run, so freshness transfers transitively; and currently unreachable because a release-tier suite is blocked on a pinned-Paseo blocker. Fix: derive the spec set per selected suite from each drill's topology `chain_spec_path` |

---

## 7. Refuted candidates

29 of 41 candidates did not survive verification. The instructive ones:

- **Oracle `recompute_proof` evidence hash** (`crates/oracle-core/src/lib.rs:1859`). `hash_evidence`
  is genuinely a GF(2)-linear XOR fold — byte rotations are bit permutations, the rotation amount
  depends on position not data, and second preimages are constructible byte-wise in O(L), not even
  requiring linear algebra. It sits behind a permissionless extrinsic that writes a final component
  value. **Refuted on reachability:** `recompute_proof` fails closed unless `(component, spec_version)`
  is in `Recomputable`, whose genesis default is empty, which neither shipped preset seeds, for
  which `note_recomputable` has zero production callers, and which no migration or raw chain spec
  touches. The candidate's claimed trigger — "welfare's `register_spec` declares its first
  recomputable MetricSpec" — is factually impossible: `MetricSpec` has no `recomputable` field.
  Both functions are in-code-documented stand-ins for the unbuilt A7 subsystem. **Engineering note
  for the A7 milestone:** `Recomputable` must not be populated by genesis, seam or migration before
  `hash_evidence` is a real cryptographic hash and `recompute_value` actually evaluates
  `formula_ref` — today that ordering is enforced only by the accident that the seam was never wired.
- **Oracle watchtower-quorum bond forfeiture.** Refuted: the quorum-failure branch and the
  quorum-*success* branch one line up both emit `ReporterWins` over the same durable challenger
  stack, so causing a quorum failure yields the reporter no differential — and 07 §5.3 makes
  loss-by-default the specified outcome for a party that does not fund the round.
- **Release-train and CI gate findings** (tag pushes skipping `ci.yml`; `property-gates.sh` passing
  on a zero-test filter; limit-coverage markers in orphan files; the self-declaring coverage
  registry; obsolete weight acknowledgements; `--components-only` empty-inventory pass;
  `generated-weight-overrides.toml` scope). All mechanically accurate, all refuted on impact or
  actor: each requires merge or tag rights (a trusted party), and every accidental shape was found
  to be caught by a release-blocking sibling gate. Several remain worth non-security tickets, in
  particular the ledger property shard's filter-vs-target asymmetry (`tools/ci/property-gates.sh:34`),
  which is the one that can go green having run nothing.
- **Chain-alerts exporter fail-open.** The pre-domain scrape section does freeze every series at its
  last healthy value. Refuted because `deploy/monitoring/README.md:113-122` **mandates** operator
  meta-alerting on `bleavit_chain_scrape_errors_total`, which this path increments every finalized
  head; doc 12 explicitly assigns that detection to §6.1 rather than a §6.3 row; and a node that can
  make the call fail can equally return well-formed healthy lies, which the proposed fix would not
  address. Worth a monitoring bug (owner O5), not a security finding.
- **Supply-chain hardening candidates** — relay binaries verified against a same-host `.sha256`
  sidecar, Chopsticks fetched via unpinned `npx`, the keeper's `--signer-uri` argv exposure. All
  accurate; all excluded as hardening rather than concrete vulnerabilities, and all already
  triaged Low/Informational by the prior report (F-01, OFF-04, OFF-07).
- **Doc-table tolerance gate** (`tools/reference-model/check-doc-table.py:38`). The tolerance really
  is derived from the audited literal's own precision, and the doc-13 leg really checks only the V5
  row of six. Refuted: nothing mechanical consumes those markdown numbers — the value is
  independently pinned in `crates/futarchy-fixed`, `pallets/market/src/tests.rs`, the vector corpus
  and the Python tests — so the realizable consequence is an imprecise number in a specification
  document.

The prior report's two remaining open items were re-checked and stand as that report describes.
ACL-01 in particular is real but confers no escalation, since track 2 dominates every other values
track.

---

## 8. Attacked and held

Recorded so the negative results are auditable rather than invisible.

- **`SafetyFilter` completeness (I-10/I-11).** Every call-nesting surface in the runtime is closed.
  `utility.dispatch_as`/`as_derivative` denied outright; `if_else`/`dispatch_as_fallible` fail closed
  in `project_inner`; `proxy`/`proxy_announced`/`as_multi`/`as_multi_threshold_1` set
  `in_proxyish_wrapper`, which denies a privileged leaf **recursively** through any inner
  batch/with_weight/sudo layer; `scheduler.*` denied for every origin with
  `ScheduleOrigin = InternalSchedulerOnly`; `sudo_as` denied and `sudo` recursed;
  `pallet_xcm.send`/`execute` denied both by the classifier and by
  `SendXcmOrigin`/`XcmExecuteFilter = Nothing`. Confirmed against the pinned SDK that
  `pallet-multisig 49.0.0` and `pallet-proxy` re-dispatch with `RawOrigin::Signed`, resetting the
  base filter, and that `pallet-utility`'s three bypass calls all `ensure_root` first.
  `project_inner`'s per-pallet match is exhaustive, so a new SDK call variant is a compile error,
  and budget exhaustion projects to `Leaf(Nobody)`.
- **XCM posture.** `OriginConverter = ()`, `Aliasers`/`UniversalAliases`/`IsTeleporter` empty; no
  `SovereignSignedViaLocation`, `ParentAsSuperuser`, `RelayChainAsNative` or
  `SignedAccountId32AsNative` in production wiring, so no foreign location becomes a local dispatch
  origin. `DenyUnsupportedInstructions` excludes `DescendOrigin`/`UniversalOrigin`/
  `ExecuteWithOrigin`/`AliasOrigin`, which is what makes the chain-level `AcceptedXcmOrigins` hold.
  The `phase3.tvl_cap` gate sits on the verified mint point. The 07 §8 reserve-probe response router
  requires all four of origin, querier, flag bit and an exact pending-id match.
- **Conditional ledger and inflow caps.** Two independent passes reached no findings. Every USDC
  exit is coupled to one of three sources; `pay_proposal`/`pay_baseline` use checked subtraction on
  the vault's own escrow; all divisions floor against the claimant and fragmenting any operation
  strictly reduces the payout, so dust loops and split-then-merge cycles are loss-making. The
  protocol-status-flip attack is structurally closed by a byte-prefix predicate over a permanently
  reserved namespace. All 26 ledger and 13 treasury dispatchables carry correct origin checks.
- **LMSR numerics and the fixed-point kernel.** `U256` primitives, `exp2`/`log2`/`ln`, and the exact
  `48·b` domain compare are sound with every intermediate checked or provably in range. Rounding is
  maker-adverse on every path, so a buy→sell round trip always loses both fees. The κ clamp's
  `pow_1e9_up`/`mul_1e9_up` pairing rounds strictly inward, so the admitted band never exceeds the
  real-arithmetic envelope (I-13).
- **Welfare normalization kernel (05 §4.6).** `percentile` is total, the trailing-12 assembly is
  length-independent, `minmax` and `freeze_constants` fail closed on a zero-width range after the
  `log1p` transform rather than fabricating 1.0, and winsorization pins both tails so an
  attacker-supplied outlier cannot move an honest participant's normalized value.
- **`fast-timing` cannot reach a release runtime.** Declared in no `default` feature list, enabled
  transitively by nothing, every compressed constant `#[cfg]`-paired with a byte-identical
  production arm, and pinned by a release-invariance test.
- **Attestation-monitor cryptography.** Re-verified as cryptographic code and exercised
  numerically: RFC 8032 §7.1 vectors pass, a flipped message byte is rejected, `S ≥ L` is rejected
  (no malleability), all eight canonical small/low-order points are rejected via the now-projective
  comparison, non-canonical `y ≥ p` is rejected, and the degenerate division-by-zero shortcut is
  unreachable. Revocation is checked before verification and keyed to the record whose key actually
  verifies; the ≥2 thresholds are over a set of key ids, so a duplicated blob or an echoed TXID
  cannot double-count; the per-file comparison uses the map inside the verified bytes. Every
  exception path forces `integrity_ok = 0`. The AUD-2 fix is correct.
- **Frozen contract surface.** Pallet indices `Epoch = 61`, `ExecutionGuard = 62`,
  `InflowCaps = 63` confirmed; `FutarchyApi` declares and implements exactly the 11 frozen methods
  in 02 §3 order with matching view-type layouts; `INTEGRATION_CONTRACT_VERSION = 15` agrees with
  02 §13. Both runtime APIs are read-only throughout, and `decision_stats` is gated on
  `record.sealed` so no in-window TWAP leaks.
- **Genesis presets and panic discipline.** Only `development` and `local_testnet` presets exist,
  both explicitly dev with the sudo key `bootstrap`-gated; vesting is a single schedule with a
  one-year cliff and the allocation sums are `const`-asserted against `VIT_TOTAL_SUPPLY`. No
  `unwrap`/`expect`/`panic!`/`unreachable!` on any non-`try-runtime` path in the runtime scope
  reviewed.
- **No injection surface in the Python tooling.** No `shell=True`, `os.system`, `pickle`,
  non-safe `yaml.load`, `eval`/`exec`, XML parsing or `extractall` anywhere in the release,
  monitoring, deploy or env tooling; all `subprocess` calls pass argv lists. No workflow uses
  `pull_request_target`, `workflow_run` or `issue_comment`; no `${{ github.event.* }}` reaches a
  `run:` block; the repository holds no `secrets.*` references at all.

---

## 9. Suggested remediation order

1. **MAX-03** — no attacker required, fires through the intended upgrade path, and the TOCTOU
   window means it can land unattended. Fix first.
2. **MAX-01, MAX-02** — one ordinary extrinsic each, both terminal. MAX-02's fix also closes MAX-09.
3. **MAX-04, MAX-06** — both are one allowlist in the same file, and both gate the artifact
   operators actually boot.
4. **MAX-05** — needs a `pub` export from `market-core`; the try-state assertion closes the class.
5. **MAX-08, MAX-10, MAX-11, MAX-12** — each a small, local change; MAX-12 is literally one line
   plus two exported fields.
6. **MAX-07** — the largest design change (metadata integrity for the keeper), and the one whose
   blast radius is confined to an operator's own float.

---

## 10. Remediation status (2026-07-27)

All twelve confirmed findings and both sub-threshold items are fixed on
`fix/opus5-max-security-review`, branched from the reviewed tree `8a95ef4`. Each carries a
regression test written to fail at baseline. This section records what was actually done, including
where the fix differs from the recommendation above and why.

| Id | Status | Fix |
|---|---|---|
| MAX-01 | fixed | Two independent halves, because either alone leaves the wedge reachable. (a) `record_snapshot` admits only the epoch's **admissible set** — its active spec ∪ every version a live cohort froze for it (I-16) — through a new `SnapshotSchedule::frozen_spec_versions` seam the runtime binds to the same projection `pallet-registry` already uses, so welfare and the registry cannot disagree about which versions an epoch carries. The check lives in `welfare-core` *after* `SpecNotFound`/`SpecNotActive`, so the precise errors survive and the frame-free differential oracle models the rule. (b) `MAX_SNAPSHOTS` = `SNAPSHOT_RETENTION_EPOCHS × (MAX_CONCURRENT_FROZEN_VERSIONS + 1)` = 60. The multiplier is `k + 1`, not `k`: the cohorts measuring epoch `e` were created at `e−1` and `e−2`, so they carry the versions active *then*, and a version activating at `e` itself is a lawful third that neither froze — reachable through two ordinary `register_spec` calls activating in consecutive epochs. Sizing at `× k` would have re-created the same wedge one activation cadence later. Dropping the active version from the union instead is not available: it is the only version `note_snapshot_recorded` advances the deadline on, so refusing it *is* the wedge. `MAX_GATE_FLAGS` and the 21-epoch shared prefix index are epoch-keyed and were **decoupled** onto the new `SNAPSHOT_RETENTION_EPOCHS_BOUND`, as was the runtime's prune cutoff — it read `current − (MAX_SNAPSHOTS_BOUND − 1)` and would otherwise have doubled the retained window to 39 epochs. Spec: 02 §9/§13 (contract **v16**), 05 §4.6, 13 §4 |
| MAX-02 | fixed | `attest` refuses a `pid` `pallet-epoch` does not carry (new `AttestorProposalStatus::exists`; `UnknownProposal`), and enforces a per-signer share of the frozen ledger: `MAX_ATTESTATIONS_PER_ATTESTOR = MAX_ATTESTATIONS / MAX_ATTESTORS = 16` (`AttestorQuotaExceeded`). **Derived from the two frozen bounds rather than chosen**, and preferred to re-keying `Attestations` per proposal because that is a 02 §7.5 storage-shape change; the property obtained is the one that matters — no coalition short of the entire roster can exhaust the vector, and every seat retains the room 06 §7's 2-of-N quorum needs. `TooManyAttestations` survives as the storage backstop, now reachable only through genesis, a migration or roster rotation |
| MAX-03 | fixed | `recovery_trigger` gives the phase-transition cause **precedence** over any cursor cause instead of matching it only at `Cursor == None`; `RecoveryAwareMigrations::step()` discards an SDK cursor auto-onboarded while the wrapper is refusing to service the migrator (`index == 0` with no inner cursor — exactly what `onboard_new_mbms` writes, so a cursor that advanced is never dropped); and `TerminalRecoveryTransition` clears a stray retired cursor rather than hard-refusing its own trigger. The R-1 deviation is resolved in the direction 09 §3.2 describes. The new test **drives a genuinely refused `PhaseFourTransition`** (the SQ-383 under-floor condition) and asserts the trigger is reached, rather than seeding the post-state as the existing `cfg(recovery)` coverage does |
| MAX-04 | fixed | `validate-chain-spec.py` allowlists top-level `ClientSpec` keys — an allowlist, because `sc-chain-spec` deliberately omits `deny_unknown_fields` — and hard-fails a non-empty `codeSubstitutes`, `forkBlocks` or `badBlocks`. Empty values pass, since `{}`/`[]` is what `#[serde(default)]` produces |
| MAX-05 | fixed | `market_core::double_depth` makes doubling `b` and recomputing `last_quote_1e9` one kernel operation both seeding paths call, so neither can half-apply it; `quote_1e9` is exported so consumers can verify rather than trust the cached scalar. A try-state assertion that `last_quote_1e9 == price(q_long, q_short, b)` for every book **closes the class** — it immediately caught two pre-existing fixtures that moved `q` without the quote |
| MAX-06 | fixed | Production specs must carry `sudo.key` (present and SS58-valid) and `constitution.phaseFlags == SHADOW_MODE\|SUDO_PRESENT`; genesis-patch sections are allowlisted. The key is a launch-ceremony output, so it takes the Coretime-seat treatment rather than a pinned constant: an explicit `"TODO"` seat in `deploy/genesis/allocations.template.json` that the existing `contains_todo` scan refuses to let an operator ship |
| MAX-07 | fixed | The keeper pins chain identity (`genesis_hash`) and the metadata **call shapes** it will sign (`call_hashes`, validated per crank before signing, via `PalletMetadata::call_hash`). Refusals are expected failures, not transport failures — reconnecting to the same hostile endpoint changes nothing and the keeper must not fall back to an unvalidated shape. With no pins configured the keeper keeps its previous posture and logs every observed shape for adoption, so an upgrade does not silently take an operator offline; both pins are documented in `keeper/README.md`. The validated metadata instance is also the **encoding** instance — see the second Codex round below. RFC-78 remains waived by subxt 0.50.2 and is not addressed here |
| MAX-08 | fixed | `record_daily_gate` requires `spec_version == active_snapshot_spec(epoch)`. A cohort having frozen another version deliberately does **not** widen it: `GateBreachFlags` is keyed by epoch alone and settles money, so it admits exactly one version |
| MAX-09 | fixed | `RuntimeAttestorProposalStatus::is_terminal` is `is_none_or`, matching the execution guard's twin, with the contract that the predicate is total stated on the trait method |
| MAX-10 | fixed | `cancel_stream` reverts the remainder to the **originating line**, which is what 08 §1.4 says and what keeps a pot-backed line and its pot in step. The 08 §6.3 drift alarm now measures `line + outstanding stream obligations` against the pot, so a line drained by an open stream no longer reads as needing nothing. The reverse direction is deliberately still not an error: anyone can transfer USDC into a keyless pot, so asserting it would let an outsider break try-state |
| MAX-11 | fixed | `has_components` reads `after.ranges` (the tool's own regeneration) only; the canonical 50×20 fidelity is **pinned** and a committed file declaring anything else is a hard failure, rather than fidelity being text-equality against the audited file's own header; and `parse_weight_file` rejects a declared range binding no slope **and** no function parameter, closing the forgery at the parser for every consumer. A real component-bearing function is still advisory at reduced fidelity — that demotion is legitimate and is pinned by its own test |
| MAX-12 | fixed | A class with `decidable_harm == 0` is a normative violation rather than a `0.000000` pass, in `normative_violations`, in the artifact's class gate, and in `_check_metric_row` (class rows only — a *stratum* legitimately empties, and the committed artifact already carries three PARAM bands at zero). `bleavit.sim-calibration.v1` now exports `false_pass_counts`, and `check-phase0-exit.py` enforces a non-zero denominator and rate/count agreement itself rather than trusting the rate |
| MAX-S1 | fixed | The `foreignAssets.accounts` exhaustiveness rule applies per **declared asset**, and an endowment naming an undeclared Location is rejected outright |
| MAX-S2 | fixed | `validate_artifact_binding` derives its spec set from each **selected** suite's own topology (`Network:` → `chain_spec_path`), binding only Bleavit-built specs — relay/Asset-Hub/Coretime specs come from the pinned Paseo tree and carry a different `:code` by construction. A suite naming no Bleavit spec is a fail-closed error. The path each topology declares is what gets hashed — see the second Codex round below |

**Not addressed, deliberately.** The A7 sequencing constraint recorded in §7 (`Recomputable` must not be
populated before `hash_evidence` is a real cryptographic hash) is a note for a future milestone, not a
defect in the current tree; nothing was changed for it. RFC-78 `CheckMetadataHash` remains `Disabled`
on every keeper signature because subxt 0.50.2 hard-codes it — the call-shape pins are the
substitute, and the limitation is stated in `keeper/README.md`.

**Verification.** Exhaustive `tools/ci/rust-workspace-gates.sh`; `tools/ci/fuzz-gates.sh`; all seven
`tools/*/tests` suites; reference model 58/58 with vector freshness `--check` clean; the economic
simulation suite; limit coverage, generated weights, weight storage bounds, plan tables,
spec-question batches, runbooks, alert coverage and `validate-environments.py`. `pallet_welfare` and
`pallet_attestor` weights are **regenerated at the committed 50×20 fidelity** with three
value-pinned acknowledgements: `record_snapshot` 621 → 706 reads (+80 from the record bound, +5 for
the `Epoch::CohortSchedules` walk the admissible set needs), `record_daily_gate` 106 → 186,
`register_spec` 94 → 174, `attest` 7 → 8 (the proposal-existence read). Every delta is accounted for
by a named key.

An earlier `--check` run reported PASS and was **wrong**: the `runtime-benchmarks` build could not
compile the branch at that moment, so the tool re-measured a stale wasm and the drift was invisible.
The Codex connector review caught it. The benchmark runtime is now built explicitly before
measuring, which also surfaced a fourth defect the stale artifact had hidden —
`pallet_epoch::settle_cohort` could not be benchmarked at all, because its fixture seeded one
epoch-keyed `GateBreachFlags` entry per `(epoch, spec_version)` snapshot record and the two bounds
are no longer the same number. `tools/simulation/run-calibration.py --check`
is red identically before and after this branch (recorded config vs executable defaults) and is not
caused by it.

**Second Codex round (2026-07-28).** Two P1 findings, both against code this branch introduced, both
verified from source and fixed. Neither was a false positive.

*The keeper validated one metadata instance and signed through another.* `validate_call_shape` ran
against `client.at_current_block()`, but the submission then called `self.client.tx()` — which
subxt 0.50.2 defines as `at_current_block().await?.transactions()`, a **second** block view with its
own `Core_version` call and its own metadata fetch (`online_client.rs`; the config's cache is keyed
by spec version, and the endpoint states the spec version). A hostile endpoint could therefore serve
the pinned metadata to the check and forged metadata to the encoder, passing MAX-07's gate and still
redirecting the signature — the exact forgery the pins exist to stop. `Submitter::validated_tx` now
validates a `ClientAtBlock` and returns **that block's own** `TransactionsClient`, and is the only
place in the module that produces one; the nonce read moved onto the same block. The instance
binding is enforced by construction rather than by assertion, which the new tests say plainly:
they exercise the gate over the real `tests/fixtures/runtime-metadata.scale` through a genuine
`ClientAtBlock`, and no offline test can observe a second fetch that no longer happens.

*The evidence binding hashed a re-derived path.* MAX-S2's `suite_chain_specs` reduced each declared
`chain_spec_path` to its basename and `validate_artifact_binding` re-rooted it under
`zombienet/specs/out`. Every committed topology does keep its specs there, so this was latent — but
a topology naming a spec elsewhere, or a second file of the same basename, would have had the
binding hash one file while Zombienet booted another, emitting release evidence for a runtime that
was never exercised. That is the same false assertion MAX-S2 was raised to remove, one level down.
The declared path is now resolved and hashed as declared, with paths escaping the repository
refused outright, and a new test asserts every committed topology keeps its specs in the generated
directory so a future one that does not is caught here. The regression test fails at baseline
against a matching decoy in `specs/out`: `EvidenceError not raised`.
