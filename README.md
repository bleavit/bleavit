<p align="center">
  <img src="assets/Bleavit-logo.png" alt="Bleavit logo" width="160">
</p>

# Bleavit — A self-governing system

Futarchy was invented by Prof. Robin Hanson — thank you for your work; this
project exists to build one.

A **futarchy-governed Polkadot parachain**: token holders vote on *values* (what the
chain should optimize), while conditional prediction markets decide *beliefs* (which
proposals actually get executed). All consensus-critical logic is native Rust FRAME
pallets — no smart-contract environment in the trusted computing base. The canonical
client is a fully decentralized frontend: an Arweave-distributed static app running an
in-browser light client (smoldot), with no backend, no indexer dependency, and no
telemetry.

Core mechanics (see the architecture set for the normative detail): scalar Mode B
futarchy over a welfare score, LMSR market maker in verified 64.64 fixed point, a
purpose-built conditional ledger with machine-checked solvency invariants, a bonded
optimistic oracle with escalating disputes, an execution guard with narrow
class-specific origins (no unrestricted Root), and an eight-phase evidence-gated
rollout that removes `sudo` at Phase 4.

## Status

**Specification complete (2026-07-12) · Track M (M0–M3), Track A, B1a, B1b, B3, B4, B5, B6, B7, B9, B11, S1, S2, S3 and S5 implemented (2026-07-17).**

- The authoritative spec is [`docs/architecture/`](docs/architecture/README.md) —
  16 component documents + decision record, produced by resolving all 101 findings
  of an adversarial design review. Treat changes to it as rare and deliberate — the
  implementation follows the spec — but it is editable, not guarded; see rule R-1 in
  [AGENTS.md](AGENTS.md).
- Implementation progress, milestones, and the session log live in [`PLAN.md`](PLAN.md).

## Repository map

| Path | What it is |
|---|---|
| [`docs/architecture/`](docs/architecture/README.md) | The specification (00–16). Start with its README; reading order 01 → 02 → 03 → 04 → 05 |
| [`docs/integration/`](docs/integration/README.md) | **For clients** — plain-language guides to using Bleavit's hosted question service from a parachain, a contract, or an off-chain service |
| [`docs/design/`](docs/design/claude-design-kit/00-START-HERE.md) | Derived, non-normative design assets: `claude-design-kit/` packs the spec into ≤10 files + a ready prompt for generating frontend design prototypes with Claude Design |
| [`PLAN.md`](PLAN.md) | Implementation roadmap, milestone status, session log — the living source of "where are we" |
| [`AGENTS.md`](AGENTS.md) | Operating manual + rules for all coding agents (and useful for humans) |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code wiring: skills, subagents, hooks |
| `.claude/` | Automation: session-context injection, skills, subagents, path-scoped rules, and Stop-hook guards for PLAN.md freshness and README's pinned lines |
| `.codex/` | Codex CLI session playbooks mirroring the skills |
| [`Cargo.toml`](Cargo.toml), [`rust-toolchain.toml`](rust-toolchain.toml), [`.github/workflows/ci.yml`](.github/workflows/ci.yml), [`tools/ci/rust-workspace-gates.sh`](tools/ci/rust-workspace-gates.sh), [`tools/ci/check-doc-links.py`](tools/ci/check-doc-links.py) | M0 bootstrap: Rust workspace manifest, pinned toolchain components, CI skeleton, and local gate scripts; B8 added [`tools/ci/supply-chain-gates.sh`](tools/ci/supply-chain-gates.sh) (pinned cargo-audit + lockfile gates, annotated exceptions in `.cargo/audit.toml`) and the kernel-change full-sweep workflow [`sweep.yml`](.github/workflows/sweep.yml) |
| [`tools/release/`](tools/release/README.md), [`.github/workflows/release.yml`](.github/workflows/release.yml) | B8/B16: the tag-triggered release-artifact publication pipeline (02 §11; 15 §5) — reproducibly builds the selected primary runtime profile and its mandatory same-commit terminal-recovery pair, boots both artifacts for metadata/`:code` binding, then assembles chain specs, environment evidence, deterministic chainHead fixtures and the ≥10⁷-point reference sweep into a content-addressed readiness report; publishes as a prerelease until an operator attaches Arweave mirror evidence |
| `crates/futarchy-primitives/` | M1 shared primitive crate: `no_std` contract/view types, version constant, and kernel/chain/currency bounds |
| `crates/futarchy-fixed/` | M2 deterministic 64.64 fixed-point LMSR/transcendental crate with generated regression fixtures |
| `crates/question-service-core/` | N5 frame-free, `no_std` hosted-question lifecycle, sealed-report assembly, conservative manipulation certificate and identity-bound attestor median |
| `crates/bleavit-client-abi/` | N9/N10 `no_std`, runtime-independent wire ABI: the fixed hosted-report receiver (`[66, 0] ++ SCALE(ReportView)`), register/open/seal/settle encoders, and the correct-by-construction positional ingress builder |
| [`reference-model/`](reference-model/pyproject.toml), [`tools/reference-model/generate-vectors.py`](tools/reference-model/generate-vectors.py) | M3 independent Python executable spec and CI-regenerated JSON vector corpus; E5 added doc 08 §10 sustainability arithmetic, S6 added lifecycle/dispute/occupancy derivations, and N5 added the hosted-question service model |
| [`simulation/`](simulation/README.md), [`tools/simulation/run-calibration.py`](tools/simulation/run-calibration.py) | S4 agent-based Phase-0 economic simulation (15 §4.9): executed-trade LMSR ledger with adversarial agents, committed deterministic calibration evidence; sim-gated parameter publication parked pending SQ-231 |
| `pallets/`, `crates/*-core/` | Track A (complete) plus Track N through N10: each `crates/<name>-core/` is a frame-free functional core and each matching production pallet its FRAME shell. N4 adds `client-registry-core` / `pallet-client-registry`; N7 adds `pallet-question-service`; N8 wires the identity to the XCM executor; N9 adds separate client-funded USDC delivery custody and best-effort egress; N10 adds `pallet-bleavit-client`, a drop-in shell for client runtimes that is intentionally not wired into Bleavit's production runtime |
| `pallets/inflow-caps/` | B4 residual state-only pallet: the shared Phase-3 cumulative per-account USDC inflow meter and total-local-issuance mint admission check (09 §5.2); no dispatchables or standalone weights, because callers include it in their transaction/weight envelopes |
| `runtime/bleavit-runtime/` | The real Cumulus parachain runtime — `construct_runtime!` over custom + standard/system pallets (`Epoch` 61, `ExecutionGuard` 62, `InflowCaps` 63, `TrackOrigins` 64, `ClientRegistry` 65, `QuestionService` 66, `ServiceLedger` 67), `BaseCallFilter = SafetyFilter`, live constitution-backed parameters, production XCM posture, custody adapters, migrations, generated weights and PoV budgets |
| `runtime/bleavit-client-runtime/` | N10 standalone client-para harness runtime: one example `Config` for `pallet-bleavit-client`, separate from and never instantiated by `bleavit-runtime`; its raw `pallet_xcm` sender exists only for the negative ingress drill |
| `runtime/bleavit-xcm/` | B4 + N8/N9 XCM layer (runtime-independent library the runtime wires): default-deny ingress barrier (unpaid execution refused; `Transact` admitted only through N8's exact six-position client template, exact registered `Location` conversion and `ExternalClient` call domain), plus N9's separately routed, client-USDC-prepaid fixed report `Transact` that cannot reach XCM-health accounting; pinned USDC/DOT matchers, governed weight trader, reserve-probe dispatcher, coretime renewal, inflow-cap adapters and the `pallet_xcm` classifier |
| `runtime-api/` | `futarchy-runtime-api`: the `sp_api::decl_runtime_apis!` declaration of the frozen 13-method contract-v23 `FutarchyApi` (02 §3–§4a) over the view types in `futarchy-primitives`; v23 appends `service_positions` so the canonical client can read the service ledger's positions, while the monitoring-only API v4 adds isolated per-client egress counters outside the integration contract |
| `node/bleavit-node/` | B3: the collator node — a thin branding of the pinned `polkadot-omni-node` stack; the runtime ships in the chain spec, not in the node |
| `deploy/`, `tools/deploy/` | B3: chain-spec pipeline (pinned `staging-chain-spec-builder`), WSS bootnode operator manifests + the 02 §10 threshold validator, production genesis-allocation template, prepared ss58-7777 registry submission |
| [`keeper/`](keeper/README.md) | B9: the off-chain keeper reference implementation (`bleavit-keeper`) — a subxt-based service any operator can run to crank the chain's permissionless extrinsics (phase ticks, TWAP observations, decide, execute, settle, oracle/registry closes, cleanup), with Prometheus metrics per 12 §6.3. A separate cargo workspace so its dependency tree cannot disturb the runtime's exact pins; the on-chain rebate meter (08 §6.3) lives in the treasury pallet |
| [`deploy/monitoring/`](deploy/monitoring/README.md), `tools/monitoring/` | O5 + B15: the 12 §6.3 monitoring/alerting stack — Prometheus + Alertmanager configuration covering all 21 tabulated alert rows with runbook labels and release-integrity paging, the on-chain-event alerting exporter (frozen `FutarchyApi` reads, raw `ReleaseChannel`, storage prefix counts, finalized events), the 12 §5.2 out-of-band attestation monitor, and the spec-anchored alert-coverage gate. SQ-484 adds the monitoring-only local reserve-line F+R runway method plus an independently reconnecting, metadata-decoded Asset Hub collector for canonical sovereign USDC and usable DOT; malformed/unavailable remote state fails only that readiness family closed and RB-XCM owns the alerts. Infrastructure only — the frontend ships no telemetry |
| `zombienet/`, `chopsticks/`, `tools/env/` | B7 + N10: test-environment definitions as release artifacts (15 §4.7) — the existing multi-node/upgrade suite plus client-para both-way and no-return topologies, the quickstart, eight-case malformed-ingress, and finalized-proof report-pull drills; `tools/env/pins.env` remains the single pin home |
| [`models/`](models/README.md), `tools/verify/` | S1: TLA⁺ formal models of the conditional ledger and the T1–T24 proposal machine (15 §4.1) plus the pinned-TLC runner — main configs prove the invariants above anti-vacuity floors, witness configs must *violate* (reachability), mutation configs prove the invariants can fail |
| [`fuzz/`](fuzz/README.md) | S2 + Track N: `bleavit-fuzz` — five cargo-fuzz targets covering SCALE payload decode, nested-wrapper filtering, LMSR trade paths, hosted-service settlement and N8's exact XCM ingress template. Each asserts a protocol invariant rather than mere no-panic. A separate nightly-pinned cargo workspace (like `keeper/`) keeps libFuzzer + nightly from disturbing the runtime's exact pins; curated seed corpora + the `fuzz` CI job (`tools/ci/fuzz-gates.sh`) |
| [`tools/phase-gates/`](tools/phase-gates/README.md) | G0: the machine-checked 09 §7.1 Phase-0 exit gate — `check-phase0-exit.py` runs the reference-model ≡ pallets differential legs against the real repo and consumes the S4-published sim-calibration artifact **fail-closed** (absent ⇒ pending, never pass), publishing `bleavit.phase0-evidence.v1` |
| `app/` | The single client monorepo (10 §10.1). Track F builds the canonical cross-platform Bleavit client here — Arweave-distributed web app and installable PWA, with a serverless LLM handoff: verified context out, semantic intent in, and Bleavit re-derives and reconstructs every transaction itself. Also hosts N10's `packages/bleavit-client-ts`, a proof-backed PAPI bridge facade for off-chain registration, open/seal submission and finalized report reads |

## How this gets built

The project is implemented **incrementally across many agent sessions**, one PLAN.md
milestone at a time, under three standing constraints:

1. every observable behavior traces to a spec section; the spec is the source of
   truth and changes to it are rare and deliberate (rule R-1);
2. parameter values come only from doc 13 / the contract surface in doc 02;
3. the living documents (PLAN/README/AGENTS/CLAUDE) are updated in the same session
   as any change — enforced by a Stop hook.

Humans and agents alike: read [AGENTS.md](AGENTS.md), then [PLAN.md](PLAN.md), then work.

## Toolchain (pinned)

- **Runtime:** Rust / Polkadot SDK, release line `polkadot-stable2606` (umbrella crate
  `polkadot-sdk = "2606.0.0"`; D-19), FRAME + Cumulus; Zombienet, Chopsticks, try-runtime,
  TLA⁺/Quint, cargo-fuzz, frame-benchmarking (01 §9, 15 §4).
- **Frontend:** TypeScript, polkadot-api 2.x, smoldot 3.x, Vite 8, Dexie 4; Arweave
  via permaweb-deploy/Turbo; Playwright + Lighthouse CI (01 §9, 10, 12).
- **Reference model:** Python high-precision reference math, CI-regenerated vector corpus, and the ≥10⁷-point release-gated differential sweep (04 §5, 15 §4.4; B8).

M0 re-verified the initial platform pins on 2026-07-13; the detailed result is tracked as V-1 in [PLAN.md](PLAN.md).

## License

[GPL-3.0](LICENSE)

---

You theorized it, we are cooking it. Bon appétit, Prof. Hanson.
