# AGENTS.md — Operating Manual for Coding Agents

This repository implements **Bleavit**: a futarchy-governed Polkadot parachain
(native Rust FRAME pallets, LMSR conditional markets) with a canonical decentralized
frontend (Arweave-distributed static app, in-browser light client). The complete,
authoritative specification already exists; the job of every session is to turn it
into code, one milestone at a time, without ever degrading the specification or the
project's living documents.

Read this file first. Then read `PLAN.md` and the linked `plan/` items. Then work.

## Ground truth

- **`docs/architecture/` (00–16) is the single source of truth** for what to build
  (see rule R-1). Doc 00 is the decision record (D-1…D-19); 01 the system overview;
  02 the chain↔frontend integration contract (a versioned surface — see 02 §13);
  03–09 the protocol components;
  10–12 the frontend and operations; 13 the only home of parameter values;
  14 the threat model; 15 the invariants and the normative testing regime; **16 the hosted question service** — the external-client trust domain (D-20).
  Reading order for newcomers: 01 → 02 → 03 → 04 → 05, then as needed
  (`docs/architecture/README.md`).
- Constants and parameters have exactly two homes: `02` (chain identity, the
  contract surface) and `13` (everything else). Any other file that needs a value
  references them — including code (kernel constants from `futarchy-primitives`,
  tunables from `pallet-constitution::Params`; the frontend reads chain
  metadata/storage, never hardcodes).
- **`PLAN.md` and `plan/` are the single source of implementation status** — the
  short focus/index in `PLAN.md`, stable-id items under `plan/{milestones,questions,
  verifications}/`, and dated records under `plan/{log,decisions,audits,changes}/`.
  They reference architecture sections and never restate normative content.

## Rules

- **R-1 — The specification is the source of truth for behavior.** Every observable
  behavior traces to `docs/architecture/` (00–16); implementation follows the spec.
  The spec is editable — when it is genuinely wrong, ambiguous, or contradictory you
  may correct it directly rather than coding around it. Do it deliberately: keep the
  change internally consistent across the doc set (owning doc + every referencing doc
  + 00's decision record if a D-n is affected; bump `INTEGRATION_CONTRACT_VERSION` per
  02 §13 when 02 changes; changes to `02` or the INV-FE texts need the joint
  backend+frontend sign-off those docs mandate — the user speaks for both sides or
  names who does), and record substantive changes in `plan/decisions/`. When a
  semantic change is non-obvious, record the reasoning there (and create a
  `plan/questions/SQ-*.md` item if it opens a genuinely separate question) — then **decide it and
  proceed** rather than waiting. Values-layer numbers, spec rulings and
  integration-contract bumps are all yours to call: the user owns both sides of the
  sign-off 02 §13 mandates and has delegated it (2026-07-25). Reserve real questions for
  what only the user can know — their intent, an external commitment, a credential. A
  deferred decision is unfinished work, and it is often under-research in disguise: check
  whether the owning spec section already answers it first.
- **R-2 — Spec-first implementation.** Before writing code, read the owning
  architecture sections for the milestone (its *Spec* column), plus the relevant
  slices of 02, 13, and 15. Every observable behavior must be traceable to spec text.
  Never **guess** a parameter value, name, or semantics, and never resolve a
  `[VERIFY]` tag by assumption — verify against live sources and log the result in
  `plan/verifications/V-*.md`.

  **A genuinely required new parameter may be introduced** (amended 2026-07-25 by
  explicit user instruction). The prohibition is on fabrication, not on the values
  layer growing: where a mechanism the spec mandates cannot be expressed by any
  existing key, add one — but earn it, in this order, and record the work:

  1. **Prove necessity.** Enumerate the existing 13 §1/§2 keys that could carry the
     value and say why each cannot. Most often one can: check whether the owning spec
     section already names a rate or bound (it frequently does, one section over), and
     prefer reuse. A new key whose job an existing key already does is a defect, not a
     parameter.
  2. **Derive the value, never pick it.** Tie it to a kernel constant, an existing
     key, or published calibration evidence, and show the derivation. If no such
     anchor exists, the row ships `[VERIFY]`-tagged with its consumer **fail-closed**
     until evidence arrives — that is a legitimate state, not a stalled one.
  3. **State the system effects.** Which invariants, gates and consumers move if it
     is amended to each of its bounds; which direction of error is unsafe; and what
     the bounds, max-Δ and cooldown must therefore be. A parameter whose unsafe
     direction is unbounded is not ready.
  4. **Record it** in 13 (the only home for values, §1/§2), in the limit-coverage
     registry, and in `plan/decisions/` with the necessity argument.

  Escalate to the user only for a value whose **error direction is unsafe** and which
  no evidence anchors — that is a values judgement, not an implementation choice.
- **R-3 — The living documents stay true.** After every change to the repository,
  the affected `plan/` item and `plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md` are updated in
  the same session; `PLAN.md` is updated when the current focus changes. `README.md`,
  `AGENTS.md`, and `CLAUDE.md` are refreshed whenever the repo shape, commands, or
  workflow they describe changed. A session that leaves the living documents stale is
  an unfinished session (a Stop hook will remind you).
- **R-4 — The plan tree is status, not spec.** Milestone frontmatter cites
  `docs/architecture/`; each milestone's status prose lives in that item's body.
  `PLAN.md` and `plan/` never duplicate normative content. If you feel the need to
  explain protocol design there, you are writing in the wrong place.
- **R-5 — Keep going; park cleanly, never mid-air.** Work the in-progress milestone,
  else the next one whose *Depends* are ✅, else what the user names — and when it
  closes, **continue to the next item without waiting to be asked**: a session ends
  when the work or the user says so, not when a milestone happens to close. What *is*
  binding is the hand-off: finish or park each item cleanly with exact resume notes,
  and never leave the repo red without saying so in the affected plan item and session log.
- **R-6 — Quality gates before "done".** A milestone is ✅ only when the gates below
  pass and a spec-compliance review found no blockers. Never mark done with failing
  tests; report failures verbatim instead.
- **R-7 — This is financial infrastructure.** Solvency-critical code (ledger,
  constitution, execution guard — audit scope A) gets the strictest treatment:
  adversarial tests, rounding always against the claimant, status-quo default on
  every failure path (G-1), no panics, no unbounded state. When in doubt, choose the
  reading that cannot create an unbacked claim or execute a payload.
- **R-8 — Verification is spec-mandated, not optional.** Doc 15 defines the test
  regime (mock-runtime × error paths × origin misuse, PT-1…PT-8 property suites,
  differential vectors vs the reference model, generated limit-coverage suite,
  try-state everywhere, fuzz/bench/weights). Milestones carry their verification
  obligations in milestone `verify:` frontmatter — they are part of the milestone, not
  follow-up work.
- **R-9 — Commit discipline.** Conventional commits with the milestone ID, e.g.
  `feat(ledger): split/merge families with per-branch supplies (A2)`. Commit only
  when the user asks (or has standing instructions); never push, publish, or tag
  without an explicit ask. Never commit with red gates. Enable
  `git config rerere.enabled true` locally. The split `plan/` tree reduces the old
  single-file collision surface, but `PLAN.md` focus and same-day log files can still
  conflict; rerere replays your own past resolutions automatically.
- **R-10 — Honest reporting.** Report what happened: gates that failed, spec
  questions found, work left open. The next session inherits the plan-tree state —
  optimistic status lines are technical debt with interest.
- **R-11 — README's pinned lines are fixed.** `README.md` always opens, as the first
  paragraph right after the `# Bleavit` heading, with:
  > Futarchy was invented by Prof. Robin Hanson — thank you for your work; this
  > project exists to build one.

  and always ends, as the last line of the file, with:
  > You theorized it, we are cooking it. Bon appétit, Prof. Hanson.

  Both are verbatim and permanent — no rewording, trimming, or removal by any
  doc-sync pass, refactor, or rewrite. Set by explicit user instruction
  (2026-07-13). Enforced in Claude Code by a Stop hook (`guard-readme.sh`); Codex
  has no hook equivalent, so its playbooks restate this rule explicitly
  (`.codex/README.md`).
- **R-12 — Do not idle on redundant CI.** During implementation, run the targeted
  pallet/core/runtime tests and Clippy for changed crates first; once the significant
  code state is coherent and locally verified, commit and open a draft PR. Run the
  exhaustive gate exactly once for that state, then mark the PR ready and continue
  with the next logical work. A later documentation-only/status-only commit (for
  example, the final plan-tree closure) does not require the session to wait for an
  identical exhaustive CI rerun before moving on. This is a handoff rule, not a
  gate waiver: meaningful code, build, workflow, dependency, generated-artifact,
  or test changes still require their appropriate fresh evidence, and any observed
  failure must be investigated. **CI supersedes its own in-flight runs since
  2026-07-31**: `ci.yml` and `sweep.yml` carry a `concurrency` group keyed on
  `github.ref` with `cancel-in-progress` on every ref except `main`, so pushing
  again to a branch *cancels* the previous run rather than queueing beside it.
  A run that shows `cancelled` after you pushed is that, not a failure — check
  the newest run for the branch. On `main` the flag is false, so a run already
  **in progress** there is never cancelled. That protects what is running and
  **cannot** protect what is queued. GitHub keeps at most one pending run per
  concurrency group, so a second `main` commit arriving while the first still
  waits displaces the first. Verified 2026-08-08: merging #276 and #277 31
  seconds apart left `ba7a2d8b`'s run `cancelled` with `total_jobs = 0`, having
  never started a job, while `36de7ac2`'s in-progress run survived both. A full
  run here exceeds two hours, so two `main` commits inside one cycle leave the
  earlier one with **no CI record of its own**. Space them, or accept that only
  the newest tip is tested. Do not launch concurrent duplicate Cargo gates;
  `tools/ci/rust-workspace-gates.sh --changed [PACKAGE...]` provides a locked,
  changed-scope feedback loop, while the no-argument script remains exhaustive.
  When CI polling is useful, poll no more than once every five minutes. Standing
  user instruction (2026-07-23).
- **R-13 — Delegated tools always run sandboxed.** Every `codex exec` invocation
  passes an **explicit** `--sandbox` mode, and it is `read-only` unless the task
  genuinely must write files. Never `--dangerously-bypass-approvals-and-sandbox`
  (no sandbox at all), never `--dangerously-bypass-hook-trust`, and never the
  Claude Code Bash tool's own `dangerouslyDisableSandbox`. **Do not let the mode be
  implicit:** `~/.codex/config.toml` marks this repository `trust_level =
  "trusted"`, and trust suppresses *approval prompts*, not confinement — an
  invocation that omits `--sandbox` silently inherits whatever the CLI default is.
  Two operational corollaries, both learned the expensive way: pass `</dev/null`
  or `codex exec` hangs on `Reading additional input from stdin...`, and never
  point a `workspace-write` job at a tree another agent is editing, because its
  turn-level snapshot/restore reverts concurrent edits — including in files it was
  told not to touch. Verify the mode from the job log after launching rather than
  assuming it. Standing user instruction (2026-07-29).

## Session protocol

1. **Orient** — read the injected session context, then `PLAN.md`, the selected
   `plan/milestones/<ID>.md`, recent `plan/log/` records, and relevant open questions.
2. **Select** — the in-progress milestone, else the first pending one whose
   dependencies are ✅, else what the user names. Confirm scope in one sentence.
3. **Read the spec** — the milestone's cited sections, before any code (R-2).
4. **Implement** — following `.claude/rules/` path rules and the conventions of the
   surrounding code; delegate bulk test authoring to the `test-engineer` agent and
   compliance review to the `spec-reviewer` agent.
5. **Verify** — run the quality gates; fix or honestly report.
6. **Close** — update the affected plan item and today's `plan/log/` file (R-3),
   refresh `PLAN.md` focus when needed, report results, and suggest the commit.
   Apply R-12 at PR handoff: do not block the next logical work on a redundant
   exhaustive rerun caused only by a final documentation/status commit.

The `/implement` skill (Claude Code) and `.codex/prompts/implement-next.md` (Codex)
encode this loop verbatim.

## Quality gates

Run what exists; gates grow with the repo (milestone `verify:` frontmatter is authoritative
per milestone):

> **Local prerequisites for the exhaustive Rust gate (verified 2026-07-29).** The
> no-argument `rust-workspace-gates.sh` does not run on this workstation as-is;
> three environment gaps stop it, none of them code defects, and CI hits none of
> them (ext4 + `libclang-dev`). Export all three:
>
> ```bash
> export CARGO_TARGET_DIR=/tmp/<scratch>/wtarget          # $HOME is ecryptfs: ~143-char
>                                                          # filename cap kills the
>                                                          # release+benchmarks build
> export LIBCLANG_PATH=/tmp/<scratch>/libclang             # dir containing a symlink named
>                                                          # exactly `libclang.so`; clang-sys
>                                                          # matches only `libclang.so` /
>                                                          # `libclang-*.so`, and this box has
>                                                          # only `libclang.so.1` and
>                                                          # `libclang-14.so.13`
> export WASM_BUILD_WORKSPACE_HINT=$PWD                    # the wasm builder cannot find
>                                                          # Cargo.lock from an out-of-tree
>                                                          # target dir
> ```
>
> **Put the `libclang` directory somewhere session-scoped, and re-check it before a
long run (learned 2026-07-31).** `/tmp` is swept on this box: a `libclang` dir
created early in a session can be gone by the time the exhaustive gate runs, and
the failure surfaces as a `clang-sys` build-script panic (*"couldn't find any
valid shared libraries … (invalid: [])"*) that reads like a toolchain problem
rather than a missing symlink. Two further traps in the same line: point the
symlink at the **real resolved shared object** (currently
`/usr/lib/x86_64-linux-gnu/libclang-14.so.14.0.0` on this workstation), not at a
possibly absent alias such as `libclang.so.1`, and verify with both `readlink -f`
and `ls -lL` rather than `ls -l` (which happily shows a dangling one).

`tools/ci/regenerate-weights.py` needs the same first variable **plus**
> `--runtime <CARGO_TARGET_DIR>/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm`,
> because it defaults to the in-repo `target/`.

| Area | Gate (current) |
|---|---|
| Rust | `tools/ci/rust-workspace-gates.sh` — fmt · clippy `-D warnings` · `cargo test --workspace` · runtime release/`runtime-benchmarks`/`try-runtime` builds · `runtime-profile-gates.sh` (B15/B16 matrix) · `no_std` · `check-weight-storage-bounds.py` · `check-generated-weights.py` (15 §4.5 purity) · the S3 limit-coverage leg (15 §4.6 / I-22). `--changed [PACKAGE...]` is the locked, changed-scope loop; no argument is exhaustive |
| Runtime crates | `try-state` green in test envs; benchmarks compile; no new `unwrap`/`expect`/`panic!`/`unsafe` in runtime code |
| Weight drift (15 §4.5) | `python3 tools/ci/regenerate-weights.py --check --steps 2 --repeat 1` — CI job `benchmark-smoke` (a drift gate, not a smoke test; the id is kept for branch protection). `--write` regenerates, `--changed` selects moved pallets. Component slopes are re-verified at committed fidelity by the release-blocking `release.yml` job **`Component weights at committed fidelity`** |
| Fuzzing (15 §4.5) | `tools/ci/fuzz-gates.sh` (CI job `fuzz`, nightly-pinned separate `fuzz/` workspace). Long campaigns, distillation and sanitizer matrices are B8 |
| Reference model | `PYTHONPATH=reference-model/src python3 -m unittest discover -s reference-model/tests`; vector freshness via `python3 tools/reference-model/generate-vectors.py --check`; normative LMSR documentation-table agreement via `python3 tools/reference-model/check-doc-table.py` (04 §5; 15 §4.4) |
| Economic simulation (S4) | `PYTHONPATH=reference-model/src:simulation/src python3 -m unittest discover -s simulation/tests` (CI, in the reference-model job). `python3 tools/simulation/run-calibration.py` is evidence tooling, not a CI gate — `--check` is **red by design** pending SQ-231 |
| Formal models (S1) | `tools/verify/run-model-checks.sh` — pinned TLC over `models/tla/*`; main configs green above their distinct-state floor AND witness configs MUST violate. CI job `model-checking` (15 §4.1) |
| Property suites (S1) | `tools/ci/property-gates.sh` — the 03 §11 / 15 §4.2–4.3 suites at ≥10⁶ proptest cases in release with `--locked`. Optional `ledger`/`market`/`constitution`/`welfare` shard; no argument runs all. CI job `property-suites` |
| Supply chain (15 §4.5; 14 §3.6 TH-44) | `tools/ci/supply-chain-gates.sh` — four legs over **every committed lockfile, in every ecosystem** (three cargo, one npm), each cargo workspace audited from its own root. The audited set is derived from `tools/ci/audited-workspaces.toml` and cross-checked against `git ls-files`. Per-commit CI job and release-blocking `release.yml` leg |
| Tooling suites | `python3 -m unittest discover -s <dir>` over `tools/deploy/tests`, `tools/reference-model/tests`, `tools/release/tests`, `tools/phase-gates/tests`, `tools/env/tests`, `tools/ci/tests`, `tools/monitoring/tests`; plus `python3 tools/env/validate-environments.py`. Pins: the env suite needs `pyyaml==6.0.2` + `websockets==15.0.1`, the monitoring suite `pyyaml==6.0.2` |
| CI parity (pre-push helper, not a CI job) | `python3 tools/ci/check-ci-parity.py` — runs each environment-sensitive gate in the working tree and in a CI-shaped shallow clone. **Parity only: a green run does not mean CI will pass.** Run it before pushing a change to anything under `tools/ci/` |
| Monitoring (O5) | `python3 tools/monitoring/check_alert_coverage.py` — the 12 §6.3 alert-table coverage gate |
| Release sweep (04 §4 cadence) | full ≥10⁷-point corpus: `python3 tools/reference-model/generate-vectors.py --sweep-out <dir>` then `BLEAVIT_SWEEP_DIR=<dir> BLEAVIT_SWEEP_REQUIRE_FULL=1 cargo test -p futarchy-fixed --release --locked --test sweep -- --ignored`; runs in `release.yml` and on kernel/numerics changes via `sweep.yml` — not per-commit |
| App (`app/`) | `pnpm -C app install --frozen-lockfile`, then the gates catalogued in `.claude/rules/app-code.md` · *Quality gates for `app/`*. That file loads automatically whenever a session touches `app/**`, which is exactly when these gates bind. They are unchanged and non-optional — read it before running or changing any `app/` gate |
| Explainer (`explainer/`) | `npm -C explainer install`, then `npm -C explainer run verify`. A **local** gate — no `ci.yml` job — but `explainer/package-lock.json` is scanned by the release-blocking Supply chain job. Rules in `.claude/rules/explainer.md` |
| Docs | `python3 tools/plan/render.py --check` · `python3 tools/ci/check-plan-tables.py` · `check-dispatch-mirror.py` (15 §4.8) · `check-spec-question-batches.py` · `check-execute-error-codes.py` · `check-unreadable-obligations.py` · `check-release-blocker-citations.py` · `check-client-surface-obligations.py` · `tools/deploy/check-runbooks.py` · `tools/deploy/check-signers.py` · `check-integration-abi.py`; and every relative link in the living documents resolves |

> **Why each of these gates exists, and the defect it caught, lives in
> `.claude/rules/quality-gates.md`** — moved out of this always-loaded file
> 2026-08-12 (22k chars every session, spent mostly where no gate is being
> changed). That file loads whenever a session touches the gate tooling, which is
> when the reasoning binds. **Read it before you change, weaken, or add a gate.**
> The commands above stay here because R-6 binds every session.

## Repository layout

The *Status* column names what a path **is**, not how far it has got. Milestone
status lives in `PLAN.md` plus `plan/` and nowhere else (R-4).

| Path | Status | What it is |
|---|---|---|
| `docs/architecture/` | spec | The specification (00–16 + README) |
| `docs/integration/` | living | **Human-facing client documentation** (N11): nine plain-language files for people integrating the hosted question service. Non-normative — `docs/architecture/` wins on conflict, and [16](docs/architecture/16-hosted-question-service.md) is the owning doc. The quickstart's code is the integration drill's code, so CI notices when it rots |
| `docs/design/` | derived | Non-normative design-context pack (`claude-design-kit/`: spec distillations + Claude Design prompt); spec wins on conflict; regenerate after any spec change |
| `docs/superpowers/specs/` | design | Approved designs for repository-shape changes, one dated file each, written before implementation. Non-normative — `docs/architecture/` wins on conflict, and PLAN.md still owns status |
| `PLAN.md` | living | Short implementation focus, Track-E arithmetic and generated plan index |
| `plan/` | living | Per-id milestones/questions/verifications, dated logs/decisions/audits/changes, and generated human indexes |
| `tools/plan/` | tooling | Strict plan frontmatter model, one-shot migration/losslessness tools, and generated-index renderer |
| `README.md` | living | Human orientation |
| `AGENTS.md` / `CLAUDE.md` | living | This manual / Claude Code wiring |
| `.claude/` | living | Settings, hooks, skills, subagents, path rules |
| `.codex/` | living | Codex session playbooks mirroring the skills |
| `Cargo.toml`, `rust-toolchain.toml`, `.github/workflows/` (`ci.yml` · `release.yml` · `sweep.yml`), `tools/ci/`, `.cargo/audit.toml` | scaffold | M0 workspace/toolchain/CI and local gate scripts; B8 added the supply-chain gate (`supply-chain-gates.sh` + annotated pin-forced audit exceptions, SQ-135), the tag-triggered release pipeline, and the kernel-change sweep workflow |
| `tools/release/` | tooling | Release-artifact publication tooling (02 §11; 15 §5): reproducible runtime-profile builds, booted-node metadata extraction with `:code`↔wasm binding, the 02 critical-surface manifest + deterministic chainHead fixture recorder, content-addressed assembly with readiness report, the `bleavit.env-evidence.v1` contract (produced by `tools/env/run-evidence.py`, B7), `environments.json` live-env inventory — see `tools/release/README.md`. B16 added the machine-readable bootstrap/Phase-4 primary+recovery profile matrix: a release selects only the primary profile and automatically builds, boots and binds its same-commit zero-SDK-MBM terminal-recovery pair at exactly the next spec version. B15 admits the first bounded primary MBM only with its paired exhaustive ledger cutpoint repair. A real tag release still fails closed on missing per-release B7 evidence and the manifest's unresolved adoption blockers. |
| `crates/` | code | `futarchy-primitives` (M1), `futarchy-fixed` (M2), Track A's per-pallet frame-free cores, N4's `client-registry-core`, N5's `question-service-core`, and N9/N10's runtime-independent `bleavit-client-abi` (receiver plus outbound encoders and ingress builder); every `crates/<name>-core/` stays `no_std` and FRAME-free. `market-core/fixtures/chain-quote-agreement.json` is the 02 §4 quote surface as this runtime answers it, consumed by `app/tests/protocol` so the client cannot drift from the charge the chain will take |
| `pallets/` | code | Production FRAME shells over the frame-free cores; Track N adds the exact-identity, native-bonded `pallet-client-registry`, N9's separately custodied USDC `delivery_float`, the two-book `pallet-question-service` with best-effort report push, and N10's drop-in `pallet-bleavit-client` for other runtimes (not Bleavit's own runtime). `pallets/inflow-caps` remains the deliberate state-only exception |
| `runtime/` | code | `runtime/bleavit-runtime` is the real Cumulus parachain runtime (`construct_runtime!`, `impl_runtime_apis!`, `BaseCallFilter = SafetyFilter`). Frozen custom slots include `Epoch` 61, `ExecutionGuard` 62, `InflowCaps` 63, `TrackOrigins` 64, `ClientRegistry` 65, `QuestionService` 66, and `ServiceLedger` 67. N10's separate `runtime/bleavit-client-runtime` is a standalone client-para example and is never wired into the production runtime |
| `runtime/bleavit-xcm/` | code | The runtime-independent XCM layer: 09 §6.1 barrier/assets/trader components, the 07 §8 reserve-probe path, coretime funding, inflow-cap adapters, call classifier and N8's exact client ingress. N9 adds a fixed report `Transact` on bare `TopicRouter`, with exact client-USDC prepayment and no type path to `HealthTrackingRouter`; the legacy inbound allowlist remains unchanged |
| `runtime-api/` | code | `futarchy-runtime-api`: the frozen **16-method** `FutarchyApi` (02 §3–§4a), `sp_api` version 5. N13 appended `service_positions` at contract v23 and v25 added `is_reserved_protocol_destination`; **contract v29 appends `bond_quote` and `treasury_streams`** (SQ-598/SQ-601/SQ-731) — the three amounts an operator must commit before the record that would freeze them exists, published as one method for both bonds because 07 §6.1 and §7 state one escrow fold under two names. `NavView` gains a trailing `insurance_target` at the same bump (SQ-602). The separate monitoring-only `TelemetryApi` is **v5** and remains outside 02 |
| `node/` | code | `node/bleavit-node` — collator binary as a thin branding of the pinned `polkadot-omni-node` stack (runtime ships in the chain spec, not the node) |
| `deploy/`, `tools/deploy/` | tooling | Chain-spec pipeline + validator (02 §8/§10), bootnode operator manifests, production genesis-allocation template, ss58-registry submission artifact; **`deploy/runbooks/` (O4)** — the 12 §6.3 runbooks-as-code set: 13 runbooks RB-KEEPER…RB-RELEASE with machine-readable frontmatter bound to doc 12's alert tables, gated by `tools/deploy/check-runbooks.py` (bidirectional §6.1/§6.3 binding; CI `docs` job + `tools/deploy/tests`) |
| `keeper/` | code | `keeper/bleavit-keeper` — the off-chain keeper reference implementation (01 §4.2 role): subxt-dynamic planner/submitter cranking every permissionless extrinsic, per-role Prometheus metrics (12 §6.3). A **separate cargo workspace** (root `exclude = ["keeper"]`): its subxt dependency tree must never perturb the runtime workspace's `=`-exact stable2606 pins; `tools/ci/rust-workspace-gates.sh` runs its fmt/clippy/test leg. On-chain counterpart: the 08 §6.3 keeper meter + `KeeperRebateSink` seams live in the treasury/crank pallets |
| `deploy/monitoring/`, `tools/monitoring/` | tooling | The 12 §6.3 monitoring/alerting stack: Prometheus scrape config + alert rules covering all 21 §6.3 rows (spec-threshold annotations, RB-* runbook labels, `severity: page` on the two page-immediately rows) + Alertmanager routing with the §5.2(3) release-integrity channel; `chain_alerts_exporter.py` (on-chain-event alerting over frozen `FutarchyApi` `state_call`, the raw 168-byte `ReleaseChannel` key, prefix counts, finalized events — per-family fail-closed degradation, never healthy zeros); `attestation_monitor.py` (the 12 §5.2 out-of-band monitor: ≥3 gateways, fetch by TXID and by name, byte-compare vs the signed `release.json` map, pure-stdlib RFC 8032/minisign verification incl. `revoked_key_bits`, ≥2 attestations, `manifest_txid` cross-check, hourly + head-driven); `check_alert_coverage.py` + `series-inventory.toml` (the coverage gate; B13 closed the 9 runtime seams via the monitoring-only `TelemetryApi` — a non-02 `decl_runtime_apis!` surface (12 §6.3) the exporter consumes over `state_call`, incl. the cumulative metadata-resolved LMSR domain-rejection counter and per-component POL series; only O3's 3 bootnode seams remain). The frontend ships no telemetry (12 §6.3); `release.json` field names remain O1-provisional; RB-* runbook documents are O4 |
| `models/` | verification | TLA⁺ formal models (15 §4.1): `tla/ledger` (proposal-vault conservation/I-3/I-26/amended-I-27/D-8 over all interleavings; fingerprint-view partition — pure-state invariants at large scopes, label invariants in no-view audit scopes) and `tla/proposal` (T1–T24, I-9/I-14/I-15/I-18, constant-controlled mutation configs wired as permanent falsifiability witnesses); per-model `manifest.env` drives `tools/verify/run-model-checks.sh` |
| `tools/verify/` | verification | Model-checking harness: digest-pinned tla2tools fetch (`tools/env/pins.env` is the pin home) + the runner with distinct-state floors and expected-violation witness legs |
| `reference-model/` | verification | Independent Python executable spec + the single vector generator and corpus. Full description moved 2026-08-06 to `.claude/rules/reference-model.md` (loads under `reference-model/**`, `simulation/**`, `tools/simulation/**`, `tools/reference-model/**`) — read it before adding a module or touching the corpus |
| `simulation/`, `tools/simulation/` | verification | The 15 §4.9 agent-based Phase-0 economic simulation over the reference model. Full description moved 2026-08-06 to `.claude/rules/reference-model.md`, which loads under `simulation/**` |
| `tools/limit-coverage/` | verification | The 15 §4.6 / I-22 generated limit-coverage gate: `check-limit-coverage.py` (strict extractor over 13 §1/§2/§4 with rule-6 ParamKey semantics + per-bound expansion of multi-limit rows; coverage checker with lexical error/behavior binding) · `registry.toml` (exhaustive classification manifest, one entry per extracted key — the counts per class are not restated here, because the checker prints them on every run and a figure kept in two places drifts: this cell read 179 keys while the manifest held 207 / 0 unwired) · `genesis-keys.json` (98 seeded keys, fixture byte-asserted against `constitution_core::genesis_params()` by a constitution test) · `tests/`. Unwired keys print on every run and expire mechanically — the checker fails once the owning milestone flips ✅; B10 cleared all consumer-binding entries; B12 cleared the last unwired key — the coretime quote leg is live with a marked dispatch-past-limit test (SQ-245/SQ-246 ruled 2026-07-18) |
| `tools/phase-gates/` | verification | The machine-checked 09 §7.1 Phase-0 exit gate: `check-phase0-exit.py` executes the reference-model ≡ pallets differential legs (the three Python legs + five Rust differential commands, incl. the full ≥10⁷ sweep unless `--reduced`) and consumes the S4-owned `bleavit.sim-calibration.v1` artifact **fail-closed** (absent ⇒ `pending-s4`, invalid ⇒ `fail`, sim `git_commit` must equal checked HEAD); the Phase-0 calibration key set (δ per class, `pol.b_baseline`, `sec.prize.*`, `sec.flow_cap`) is lexically bound to 13's sim-gated tags so spec drift fails loudly. Publishes `bleavit.phase0-evidence.v1`; exit 0 only on full Phase-0 exit. Tests in the CI tooling-suites job; the checker itself is deliberately not a per-commit gate (red until S4 by design) |
| `app/` | code | The single 10 §10.1 monorepo (pnpm workspace + its own cargo workspace, excluded from the root one). Full description **and the 26 `app/` quality gates** moved 2026-08-06 to `.claude/rules/app-code.md`, which loads under `app/**` — read it before running or changing any `app/` gate |
| `explainer/` | teaching site | The interactive explanation of the whole runtime — fourteen scenes in three acts, every on-screen number tagged `spec`/`derived`/`simulated`. **Not the canonical client** (that is `app/`): it reads no chain and ships no signing affordance, so INV-FE-1…15 do not bind it. A standalone npm project with its own `package-lock.json`, deliberately outside `app/`'s pnpm workspace; that lockfile **is** audited by the supply-chain gate. `src/protocol/` is a third independent port of the spec arithmetic, certified against the same corpus the Rust differential suites replay. Full description and rules in `.claude/rules/explainer.md`, which loads under `explainer/**`; `npm run verify` is its whole gate and it adds no CI job |
| `zombienet/`, `chopsticks/`, `tools/env/` | tooling | Test-environment definitions — release artifacts, not private fixtures (15 §4.7; 02 §11). Full description, drill status and the B7 evidence producer moved 2026-08-06 to `.claude/rules/environments.md`, which loads under `zombienet/**`, `chopsticks/**`, `tools/env/**` |
| `zombienet/drills/10–13` | N10 | Client-para both-way/no-return topologies, the quickstart binding, eight malformed-ingress cases and finalized-proof pull/XCM-health containment drill; `tools/ci/check-quickstart-drill.py` binds the Markdown source byte-for-byte to the executed helper |
| `fuzz/` | verification | `bleavit-fuzz` — five cargo-fuzz targets: `payload_scale_decode`, `nested_wrapper_filter`, `lmsr_trade_paths`, `service_settlement_paths`, and `xcm_client_ingress`; the separate nightly-pinned workspace lockfile includes N10's ABI dependency graph and is gated independently with `cargo fmt`, locked Clippy and locked tests |

## Changing the specification

The spec is complete and the product of a 101-finding review, so changes should be
rare and deliberate — but `docs/architecture/` is editable, not guarded. When a change
is warranted, follow **R-1**: make it consistent across the whole doc set (owning doc +
every referencing doc + 00's decision record if a D-n is affected), bump
`INTEGRATION_CONTRACT_VERSION` per 02 §13 when 02 changes, honor the joint
backend+frontend sign-off that 02 §13 and 15 §2.1 mandate for `02`/INV-FE edits, and
record what changed (and why, and who authorized it) in `plan/decisions/`. If a
semantic change is non-obvious, create a `plan/questions/SQ-*.md` item and confirm with
the user first.

## Where things live

- Claude Code specifics (skills, subagents, hooks): `CLAUDE.md`, `.claude/`
- Codex playbooks: `.codex/README.md`, `.codex/prompts/`
- Roadmap and status: `PLAN.md`, `plan/` · Human orientation: `README.md`
- The spec: `docs/architecture/` — start at its README
