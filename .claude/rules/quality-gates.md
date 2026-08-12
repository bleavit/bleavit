---
paths: ["tools/ci/**", "tools/verify/**", "tools/limit-coverage/**", "tools/monitoring/**", "tools/deploy/**", "tools/release/**", "tools/phase-gates/**", "tools/reference-model/**", "tools/simulation/**", "tools/env/**", ".github/workflows/**"]
---

# Quality gate rationale (why each gate exists, and what it caught)

AGENTS.md · *Quality gates* keeps the authoritative list of gates and the exact
command each one runs. It stays always-loaded, because rule R-6 binds every
session. This file carries the reasoning behind each gate, and it loads when you
work on the gate tooling itself — which is when the reasoning binds.

Read this file before you change, weaken, or add a gate. Most of what follows
records a defect that shipped behind a green gate. A gate here is rarely just a
check. It is usually the answer to something that already went wrong.

## Rust — `tools/ci/rust-workspace-gates.sh`

The script runs `cargo fmt --all -- --check`, `cargo clippy --workspace
--all-targets -- -D warnings`, `cargo test --workspace`, the runtime
release/`runtime-benchmarks`/`try-runtime` builds and the try-runtime-enabled
runtime suite (B6 — the 15 §4.7 snapshot `try-runtime-cli` leg lands with
B7/B8), `tools/ci/runtime-profile-gates.sh` for the bootstrap/Phase-4
primary+recovery matrix, exact-one bounded primary ledger MBM, exhaustive paired
repair, and recovery zero-SDK-MBM proof (B15/B16), the `no_std` build, and the
generated-weight storage-bound check (`python3
tools/ci/check-weight-storage-bounds.py`).

**The 15 §4.5 generated-weight purity gate** (`python3
tools/ci/check-generated-weights.py`). Every function in a
`runtime/bleavit-runtime/src/weights/*.rs` file must carry the generator's
`Minimum execution time:` line **and** contain nothing outside the generator's
own grammar. A term spliced into an already-generated function keeps that line,
so a marker-only check would pass it. A deliberate hand-written override needs a
justified, **mechanically expiring** entry in
`tools/ci/generated-weight-overrides.toml`, because a hand-spliced term is
deleted by the next regeneration and that reads as a weight *decrease* the
growth-only regression gate cannot see (SQ-490).

**The S3 limit-coverage leg** — `python3 -m unittest discover -s
tools/limit-coverage/tests` plus `python3
tools/limit-coverage/check-limit-coverage.py`. This is the 15 §4.6 / I-22 gate:
every 13-registry key must be classified in `tools/limit-coverage/registry.toml`,
and every dispatch-limit key must bind to a `// limit-coverage:` marked test.

## Weight drift (15 §4.5) — `tools/ci/regenerate-weights.py`

CI job `benchmark-smoke`. The id is kept for branch protection, but the job is a
drift gate rather than a smoke test.

It re-measures every pallet and diffs the committed weights **per function**.
That closes the hole `check-weight-regression.py` cannot reach: that checker
diffs HEAD against the merge base, so it sees a regeneration and never the
*absence* of one. SQ-490 is the case —
`pallet_attestor::remove_for_cause` shipped declaring 8 reads while performing
261.

It compares **worst-case totals** (base + slope × component high), never the
intercept and slope separately. That split is not fidelity-stable even where the
total is: `set_candidacy_bond` shifts its proof slope 901→1,306 at 2×1 with
worst-case writes fixed at 201.

- **Hard gate:** component range highs always, plus the storage totals of
  **constant-weight** functions at any fidelity. The measured invariant is
  `pallet_attestor` 6/6 and `pallet_collator_selection` 2/2, and the
  8-vs-261-reads defect was such a function, so a cheap per-commit run does catch
  the real thing.
- **Advisory:** ref_time always (127 % measured spread), and
  **component-bearing** functions unless the run's fidelity matches the committed
  header. A 2-point fit can lose a linear term outright (`new_session`:
  worst-case writes 100 at 50×20 versus 3 at 2×1), and losing it understates.

Those advisory cases are gated by the release-blocking `release.yml` job
**`Component weights at committed fidelity`** (`--check --components-only --steps
50 --repeat 20`, over the 16 of 32 pallets carrying a fitted component, derived
rather than listed). `publish` depends on that job, so nothing ships on a slope
that was never verified at the fidelity it claims.

`--write` regenerates. `--changed` selects pallets whose local source moved.

A pallet whose `--extrinsic '*'` run aborts on one unsatisfiable fixture no
longer discards its other functions. The tool takes its work list from the
runtime (`--list`, so a benchmark added since the last generation cannot be
skipped), probes, regenerates the rest, and carries the unmeasurable one forward
only if `tools/ci/weight-preservation.toml` declares it. A marker alone buys no
exemption, and the two are cross-checked in both directions.

## Fuzzing (15 §4.5) — `tools/ci/fuzz-gates.sh`

CI job `fuzz`, over the nightly-pinned separate `fuzz/` workspace:
fmt/clippy/oracle-unit-tests, `cargo fuzz build` for each target, corpus
regression (`-runs=0`), and a short random smoke (`FUZZ_SMOKE_SECONDS`, default
30). Long campaigns, distillation and sanitizer matrices are B8.

## Economic simulation (S4)

The calibration runner `python3 tools/simulation/run-calibration.py` is evidence
tooling, not a CI gate. `--check` re-verifies the committed
`simulation/results/phase0-calibration.json` — structure, byte-exact pinned
subsample, Merkle root — and deliberately exits 1 while the artifact records
economic violations. That red is by design, pending SQ-231. `--full` regenerates
the ≥ 10⁴-proposal Phase-0 evidence (15 §4.9), which G0 consumes.

## Formal models (S1) — `tools/verify/run-model-checks.sh`

Pinned TLC over `models/tla/*` per each `manifest.env`. Main configs must be
green above their distinct-state floor **and** witness configs MUST violate, which
is the reachability anti-vacuity check. CI job `model-checking` (15 §4.1).

## Property suites (S1) — `tools/ci/property-gates.sh`

The 03 §11 / 15 §4.2–4.3 suites at ≥10⁶ proptest cases in release with
`--locked`. The script hard-rejects a lower `PROPTEST_CASES`. Reduced-count runs
happen implicitly in `cargo test --workspace`. CI job `property-suites` fans out
per-crate across parallel runners: the script takes an optional
`ledger`/`market`/`constitution`/`welfare` shard, and no argument runs all.
`welfare` covers the 05 §4.6 normalization kernel's percentile, winsorization and
min–max properties (SQ-502).

## Supply chain (15 §4.5; 14 §3.6 TH-44) — `tools/ci/supply-chain-gates.sh`

Four legs over **every committed lockfile, in every ecosystem**.

Cargo gets three: the committed-lockfile assertion (`cargo metadata --locked`),
pinned `cargo-audit 0.22.2`, and the **GHSA-only leg** (`check-ghsa-only.py` over
pinned `osv-scanner`, with annotated `tools/ci/ghsa-waivers.toml`). RustSec is a
strict subset of the GitHub Advisory DB for crates.io, so cargo-audit is
structurally blind to GHSA-only advisories. This leg gates exactly that
complement, and nothing cargo-audit already sees (SQ-219).

npm gets the fourth: `check-npm-advisories.py` over the same pinned
`osv-scanner`, which picks its ecosystem from the lockfile's own name. That leg
**skips nothing**, because no second scanner stands behind it. Feeding
`app/pnpm-lock.yaml` to the GHSA-only checker instead would have looked correct
while its stated reason was false, since RustSec covers crates.io alone.

`pnpm audit` is deliberately not used. It ships whatever pnpm ships rather than a
pinned digest, its feed is npm's own GHSA mirror which OSV already aggregates,
and `pnpm.auditConfig.ignoreCves` cannot expire. Waivers live in
`tools/ci/npm-advisory-waivers.toml`, keyed on package **and version** so a bump
demands fresh triage. Every entry must declare `reaches_bundle`, and **`"yes"` is
refused outright** — TH-44's impact is hostile code in the bundle, and that gets
patched rather than excused.

The audited set is **derived, never restated**.
`tools/ci/audited-workspaces.toml` classifies every lockfile with its ecosystem,
and `check-audited-workspaces.py` fails on any mismatch against `git ls-files` in
either direction, over every lockfile name it knows. That check exists because
the gate used to name two lockfiles inline: `app/Cargo.lock` (the F22 Tauri
desktop shell, 17 findings) and `fuzz/Cargo.lock` (5) arrived later and were
audited by nothing while the job stayed green, since a coverage hole reports as
silence rather than absence (SQ-985). `app/pnpm-lock.yaml` was the same hole one
ecosystem over and outlived the cargo one, because a checker that only listed
`*Cargo.lock` could not have found it however carefully it compared — and TH-44
had named `npm audit`/OSV CI as a mitigation since the threat model was written.

Each cargo workspace is audited **from its own root** per 15 §4.5 clause 4,
because cargo-audit reads `.cargo/audit.toml` from its working directory and one
workspace's pin-forced exception must never mask another's vulnerability. The
`bleavit.supply-chain.v4` summary reports each workspace's own ignore list so that
isolation is re-proven on every run, plus `waived_npm` and `npm_lockfiles` so a
release cannot disclose the cargo half and stay silent about the half a browser
executes.

Per-commit CI job and release-blocking `release.yml` leg.

## Tooling suites

`python3 -m unittest discover -s <dir>` over `tools/deploy/tests`,
`tools/reference-model/tests`, `tools/release/tests`, `tools/phase-gates/tests`,
`tools/env/tests`, `tools/ci/tests` and `tools/monitoring/tests`, plus `python3
tools/env/validate-environments.py`.

Since 2026-08-03 `tools/ci/tests` also checks **the workflow's own wiring**: every
`pnpm`/`npx`/`node` step in a subdirectory job must run from that directory, every
`pnpm run <script>` must name a script that exists, and `cancel-in-progress` must
keep exempting `main`. It was added because three steps ran `pnpm` from the repo
root, and the first symptom was corepack silently downloading an unpinned pnpm
(V-90). `check-ci-parity.py` cannot see this, since it runs gates and never reads
the workflow.

Dependency pins: the env suite needs `pyyaml==6.0.2` plus `websockets==15.0.1`,
and the monitoring suite needs `pyyaml==6.0.2`.

## CI parity — `python3 tools/ci/check-ci-parity.py`

A pre-push helper, not a CI job. It runs each environment-sensitive gate twice —
once in the working tree, once in a shallow single-branch clone shaped like
`actions/checkout@v7` — and fails on any gate that passes locally but not in CI's
checkout.

It exists because a green local `rust-workspace-gates.sh` shipped a red Rust CI
job: `check-weight-regression.py` defaults its base to `git merge-base HEAD
origin/main`, which the worktree had fetched and CI's bare checkout did not.

**Parity only.** A green run does not mean CI will pass. It means no gate depends
on state only your worktree has. Run it before pushing a change to anything under
`tools/ci/`.

## Monitoring (O5) — `python3 tools/monitoring/check_alert_coverage.py`

The 12 §6.3 gate. Both alert tables are strictly extracted. Every row must bind to
at least one Prometheus rule carrying the row's exact RB-* runbook, and the two
"page immediately" rows must carry `severity: page`. Every rule metric must be
declared in `tools/monitoring/series-inventory.toml` and present in the exporters'
`SERIES` registries. Declared seams expire mechanically once their owning PLAN.md
milestone (B10/O3) flips ✅.

## Explainer (`explainer/`)

`npm -C explainer run verify` is a **local** gate — this project adds no job to
`ci.yml`. It is not outside every gate, though, and the exception is the one worth
remembering: `explainer/package-lock.json` is classified in
`tools/ci/audited-workspaces.toml`, so the release-blocking **Supply chain** job
scans it on every commit, and an advisory in a teaching dependency turns the whole
repository red.

## Docs

**Plan indexes** (`python3 tools/plan/render.py --check`). The files under
`plan/{milestones,questions,verifications}/` and `plan/decisions/` are the only
inputs. A committed index that differs from a fresh render fails, so generated
tables cannot become a second source of truth.

**Living/spec table structure** (`python3 tools/ci/check-plan-tables.py`). Standing
user instruction from 2026-07-17: table formatting must never drift or break.
Also a Stop hook.

**The 09 §1.2 ↔ 11 §11.5 dispatch-check mirror** (`python3
tools/ci/check-dispatch-mirror.py`, 15 §4.8). It parses both lists **and the
mapping 11 §11.5 declares**, then tests that claim for completeness, so the
checker cannot agree with a copy of itself. It must fail on a frontend
precondition with no backend check behind it, which is a client refusing an action
the runtime would accept. Added 2026-08-03: until then both documents cited this
diff and neither doc 15 nor any suite implemented it, which is how an `execute`
precondition on a clock that `execute` itself starts survived since X-11i
(SQ-552).

**Spec-question batch consistency** (`python3
tools/ci/check-spec-question-batches.py`): every question's `batch:` names a
declared batch and resolved items are not kept in the open backlog. Unique ids
are now structurally enforced by one file per id.

**The canonical client's `execute` reason codes are the runtime's own** (`python3
tools/ci/check-execute-error-codes.py`, 11 §11.5). The dispatch mirror binds two
*documents*, and nothing bound the client's `ExecuteErrorCode` table to
`pallet_execution_guard::Error<T>`. §11.5 requires every failure to block *"with
the same reason code the runtime would return"*, and four of the client's codes
were names the runtime has never returned: `NotQueued` for `NotFound`/`Cancelled`,
`VersionMismatch` for `StaleQueue`, `MeterExceeded` for `MetersBlocked`,
`GateSuspended` for `GuardianHold`. `tsc` structurally cannot see this — a union
member and its use site move together, so a renamed code compiles — which is why
it is a gate rather than a review habit. The binding is deliberately
**one-directional**: the guard declares many variants `execute` cannot reach, and
demanding those of a client would demand it model checks it never makes. The
complementary *mapping* claim — which arm raises which error — lives in
`app/tests/screens` bound to `do_execute`'s body, since `QueueFull` is a real
variant `execute` never returns.

**Every `blocking` client obligation expires with the question it waits on**
(`python3 tools/ci/check-unreadable-obligations.py`, added 2026-08-06).
`app/packages/transaction-builder/src/rows.ts` declares the 11 §11.8 reads 02
freezes no surface for, and a `blocking` entry CLOSES an operator control through
`operatorGate`. The file claimed those declarations expire *"by the row closing,
not by somebody remembering to delete a comment"* and nothing enforced it:
contract v28 resolved SQ-615/616/619 in a branch's own base and three entries
stayed, so the guardian console, the upgrade crank and the registry challenge
panel could not reach `ready` at all — and a screen that can never open is one
nothing has exercised, so its suite had settled for asserting the refusal. Every
cited id must be a `plan/questions/` item whose `status:` enum is `open`.

**Every release readiness blocker expires with the question it waits on**
(`python3 tools/ci/check-release-blocker-citations.py`, added 2026-08-07) — the
same defect one layer over. `app/tools/release/` emits the blockers
`release:check --production` refuses on, and the Asset Hub descriptor blocker read
*"blocked on SQ-587"* for three days after that question was ruled **and** after
F4 had landed every artifact the set needs: the feed directory, the PAPI
descriptor entry and `FOREIGN_CHAIN_PINS`. So a finished deliverable was reported
as somebody else's open decision, under fully green CI, because neither half can
see the other — the pipeline cannot know a question closed, and the plan tree cannot
know who cites it. Every `SQ-nnn` appearing **anywhere** under that directory must
be a `plan/questions/` item whose `status:` is `open`. The breadth is the design
rather than laziness: the stale claim sat in a doc comment as well as in the
emitted string, and the strings are built by multi-line concatenation, so a rule
scoped to blocker text would need the tokenizer whose holes three gates here have
had to remove. The cost — that directory may not carry a closed question as
history — is the right trade, since the pipeline's job is to state what is
unresolved, and the decision log is what reads a ruling back.

**Every client read docs 10/11 mandate names a surface 02 actually freezes**
(`python3 tools/ci/check-client-surface-obligations.py`, SQ-580) — the **inverse**
of every other surface gate, and the reason it exists. `check-chain-feed.py`,
`surface:check` and `test:mock-runtime` all verify that what *is* declared agrees
with the runtime, and none asked whether what is *required* was ever declared,
which is how SQ-552, SQ-577, SQ-580 and SQ-581 each survived behind green gates.
The consequence is worse than a missing feature: 10 §5.2's classifier probes
exactly the frozen set, so an unfrozen read is one the compat lattice **cannot
fail on**, and a runtime upgrade that moved it would leave the client reporting
`full` while the dependent path silently broke. It extracts `Pallet.Item`
references from docs 10/11 and keeps only those whose prefix is a real
`construct_runtime!` pallet — an earlier prose sweep without that restriction
reported every capitalised dotted pair and had to be thrown away, since a gate
that noisy gets switched off rather than fixed. Gaps are waived **by open
spec-question id only**, and the waiver expires mechanically when its plan item closes
that row, so the waiver file cannot become the problem's permanent home.

**The runbook set stays bound to doc 12 §6.1/§6.3** (`python3
tools/deploy/check-runbooks.py`, O4).

**`SIGNERS.md` states what the verification code reads** (`python3
tools/deploy/check-signers.py`, F13). 12 §2.2 point 1 requires the registry by
name, and it is an *input* to point 2 rather than a rendering of it: disjointness
is evaluated over natural persons, so the operator mapping is what stops the check
intersecting key ids and passing forever. The check is bidirectional over the
rows, and it binds the document's populations, entry schema, floors and 3-of-5
quorum to `registry.ts`/`verdict.ts`, which is what keeps it non-vacuous while
every population is still empty. An unseated population prints as `unseated`,
never as a separation, and `--strict` — what a release gate runs — refuses it.

**The pure-XCM integration page agrees with the frozen client ABI** (`python3
tools/ci/check-integration-abi.py`, N11). `docs/integration/integrate-xcm.md`
publishes the call selectors, USDC location and attestor bound a client encodes
**without** Bleavit metadata, and nothing else in the repository reads that page,
so the binding is bidirectional on the call table: every frozen selector must
appear, every documented row must match one, and a call's XCM-reachability column
must match whether it really is an `ExternalClient` call.
