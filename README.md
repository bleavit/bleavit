<p align="center">
  <img src="assets/Bleavit-logo.png" alt="Bleavit logo" width="160">
</p>

# Bleavit — A self-governing system

Futarchy was invented by Prof. Robin Hanson — thank you for your work; this
project exists to build one.

<p align="center">
  <a href="https://github.com/bleavit/bleavit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bleavit/bleavit/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <a href="rust-toolchain.toml"><img alt="Rust 1.89.0" src="https://img.shields.io/badge/rust-1.89.0-b7410e"></a>
  <img alt="Polkadot SDK stable2606" src="https://img.shields.io/badge/polkadot--sdk-stable2606-e6007a">
</p>

**Bleavit is a futarchy-governed Polkadot parachain.** Token holders vote on
*values* — what the chain should optimize. Conditional prediction markets decide
*beliefs* — which proposals actually reach execution. Every consensus-critical
rule is a native Rust FRAME pallet, so no smart-contract environment enters the
trusted computing base.

> [!IMPORTANT]
> **Bleavit is not deployed.** The Phase 0 and Phase 1 exit gates passed. Phase 2
> puts the chain on the Paseo testnet, and that gate is still open. Do not commit
> real funds to any part of this repository.
> [`docs/reviews/`](docs/reviews/) holds the review reports the project has
> received so far.

## Contents

- [What Bleavit is](#what-bleavit-is)
- [How it works](#how-it-works)
- [Project status](#project-status)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [Repository map](#repository-map)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## What Bleavit is

Ordinary governance mixes two questions into one vote. Bleavit separates them
into two layers, and gives each layer a mechanism suited to it.

- **Values — what should we want?** VIT holders vote through `pallet-referenda`
  and `pallet-conviction-voting`. This layer defines the welfare metric and its
  weights. It can never enact an operational proposal.
- **Beliefs — what will actually work?** Conditional prediction markets price
  each proposal against the world without it. A proposal executes only when its
  markets say it raises the welfare score, and only when no ruin gate vetoes it.

The canonical client matches that posture. It is a static app distributed over
Arweave, and it runs an in-browser light client. It has no backend, no indexer
dependency, and no telemetry.

## How it works

Each mechanism below has one owning specification document. Follow the link for
the normative detail.

- **Scalar Mode B futarchy** over a normalized welfare score — [05](docs/architecture/05-welfare-and-decision-engine.md)
- **An LMSR market maker** in verified 64.64 fixed point — [04](docs/architecture/04-markets-and-pricing.md)
- **A purpose-built conditional ledger** with machine-checked solvency invariants — [03](docs/architecture/03-conditional-ledger.md)
- **A bonded optimistic oracle** with escalating disputes and a hard latency cap — [07](docs/architecture/07-oracle-and-disputes.md)
- **An execution guard** with narrow class-specific origins, never unrestricted Root — [09](docs/architecture/09-execution-upgrades-and-rollout.md)
- **A hosted question service** that other chains call over XCM — [16](docs/architecture/16-hosted-question-service.md)
- **An eight-phase rollout** that removes `pallet-sudo` at Phase 4 — [09](docs/architecture/09-execution-upgrades-and-rollout.md)

Two rules shape the whole repository. Every observable behavior traces to a
specification section. Every parameter value lives in exactly two documents —
[02](docs/architecture/02-integration-contract.md) for the contract surface, and
[13](docs/architecture/13-parameters.md) for everything else.

## Project status

**The specification is complete. The chain is not deployed.**

[`PLAN.md`](PLAN.md) is the single source of implementation status, and it wins
over the summary below.

| Track | What it covers | Status |
|---|---|---|
| **M** — Foundations | Cargo workspace, shared primitives, 64.64 fixed point, reference model | ✅ Done |
| **A** — Protocol pallets | Ledger, markets, welfare, oracle, guardians, treasury, execution guard | ✅ Done |
| **N** — External clients | The hosted question service other chains call over XCM | ✅ Done |
| **B** — Runtime, node and chain | Cumulus runtime, collator, XCM layer, release pipeline, keeper | 🔨 Mostly done |
| **E** — Revenue and sustainability | Redemption fee and the self-funding statement | 🔨 Mostly done |
| **S** — Verification and simulation | TLA⁺ models, fuzz targets, property suites, economic simulation | 🔨 Mostly done |
| **F** — Canonical client | The Arweave-distributed app in `app/` and its light client | 🔨 In progress |
| **O** — Release and operations | Runbooks, monitoring, bootnode operations | 🔨 In progress |
| **G** — Rollout gates | Eight evidence-gated phases, from local drills to a self-governing chain | 🔨 Phase 2 next |

The specification came from an adversarial design review, and it resolves all 101
findings that review raised. Treat changes to it as rare and deliberate. It is
editable rather than guarded — see rule R-1 in [AGENTS.md](AGENTS.md).

## Quick start

### Prerequisites

| Tool | Version | Where the pin lives |
|---|---|---|
| Rust | 1.89.0, with the two wasm targets | [`rust-toolchain.toml`](rust-toolchain.toml) — `rustup` reads it for you |
| Node.js | 22.18.0 | [`app/.nvmrc`](app/.nvmrc) |
| pnpm | 10.23.0, through corepack | `packageManager` in `app/package.json` |
| Python | 3.12 | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

The Rust build needs two native packages. On Debian or Ubuntu, install them with
`sudo apt-get install -y libclang-dev protobuf-compiler`.

### 1. Read the specification

This path needs no installation. Start at
[`docs/architecture/README.md`](docs/architecture/README.md). Then read
01 → 02 → 03 → 04 → 05 in that order.

### 2. Run the explainer

The explainer animates every mechanism in fourteen scenes. It reads no chain, so
it starts in seconds.

```bash
npm -C explainer install
npm -C explainer run dev
```

### 3. Spawn a local network

This path builds the collator and boots a relay chain beside it. Expect a long
first build.

```bash
tools/env/fetch-binaries.sh
tools/env/generate-relay-specs.sh
cargo build --release -p bleavit-node --locked
(cd keeper && cargo build --release --locked -p bleavit-keeper)
zombienet/bin/zombienet -p native spawn zombienet/networks/bleavit-local.toml
```

[`zombienet/README.md`](zombienet/README.md) documents the drills, the fast-timing
test spec, and the host requirements. The fetch script verifies every download,
then installs it. [`tools/env/pins.env`](tools/env/pins.env) is the one home for
those pins.

### 4. Run the canonical client

```bash
(cd app && corepack enable && corepack install)
pnpm -C app install --frozen-lockfile
pnpm -C app dev
```

## Documentation

| If you want to | Start here |
|---|---|
| Understand the protocol | [`docs/architecture/`](docs/architecture/README.md) — 16 component documents plus the decision record |
| Watch the protocol move | [`explainer/`](explainer/README.md) — an interactive teaching site, not the canonical client |
| Integrate a client | [`docs/integration/`](docs/integration/README.md) — plain language, non-normative, nine guides |
| Know what is built | [`PLAN.md`](PLAN.md) — milestones, verification log, decision log, session log |
| Contribute code | [`AGENTS.md`](AGENTS.md) — the rules, the quality gates, the session loop |
| Operate a node | [`deploy/runbooks/`](deploy/runbooks/) and [`deploy/monitoring/`](deploy/monitoring/README.md) |
| Design a frontend | [`docs/design/`](docs/design/claude-design-kit/00-START-HERE.md) — a derived, non-normative design kit |
| Report a vulnerability | [`SECURITY.md`](SECURITY.md) |

## Repository map

| Path | What it is |
|---|---|
| [`docs/architecture/`](docs/architecture/README.md) | The specification, and the source of truth for every behavior |
| [`docs/integration/`](docs/integration/README.md) | Human-facing guides for people who integrate a client |
| [`PLAN.md`](PLAN.md), [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) | Status, the operating manual, and the Claude Code wiring |
| `crates/` | Shared primitives, the fixed-point kernel, and frame-free `no_std` functional cores |
| `pallets/` | Production FRAME pallets, mostly thin shells over those functional cores |
| `runtime/`, `runtime-api/`, `node/` | The Cumulus runtime, the frozen `FutarchyApi`, and the collator binary |
| `app/` | The canonical client, and the TypeScript port of the market math |
| [`explainer/`](explainer/README.md) | The interactive teaching site — no signing affordance, no chain reads |
| [`reference-model/`](reference-model/pyproject.toml), [`simulation/`](simulation/README.md) | An independent executable specification in Python, plus the economic simulation |
| [`models/`](models/README.md), [`fuzz/`](fuzz/README.md) | TLA⁺ formal models and the invariant fuzz targets |
| [`keeper/`](keeper/README.md) | The off-chain keeper that cranks permissionless lifecycle extrinsics |
| `deploy/`, `zombienet/`, `chopsticks/` | Chain specs, runbooks, monitoring, and the test environments |
| `tools/` | CI gate tooling and the [release pipeline](tools/release/README.md) |
| [`SIGNERS.md`](SIGNERS.md) | The signer registry, whose populations print as unseated until the key ceremony |

[AGENTS.md · Repository layout](AGENTS.md#repository-layout) carries the long-form version of this
table, one row per path with its milestone status.

## Development

### Pinned toolchain

- **Runtime:** Rust and the Polkadot SDK on release line `polkadot-stable2606`,
  with FRAME and Cumulus. Verification uses Zombienet, Chopsticks, try-runtime,
  TLA⁺ and cargo-fuzz.
- **Client:** TypeScript, polkadot-api 2.x, smoldot 3.x, Vite 8 and Dexie 4.
  Arweave distribution runs through permaweb-deploy and Turbo.
- **Reference model:** Python high-precision arithmetic, a regenerated vector
  corpus, and a release-gated differential sweep of at least 10⁷ points.

### Quality gates

Run the changed-scope Rust gate while you work. It locks the dependency graph and
skips what your change cannot reach.

```bash
tools/ci/rust-workspace-gates.sh --changed <package>
```

The same script with no argument runs the exhaustive gate. That run takes hours
on a cold machine, so let CI carry it. The other suites each own one area:

```bash
pnpm -C app install --frozen-lockfile && pnpm -C app test
npm -C explainer run verify
PYTHONPATH=reference-model/src python3 -m unittest discover -s reference-model/tests
```

[AGENTS.md · Quality gates](AGENTS.md#quality-gates) lists every gate with the specification
section that mandates it.

### How this gets built

Coding agents build the project one [`PLAN.md`](PLAN.md) milestone at a time,
under three standing constraints:

1. Every observable behavior traces to a specification section (rule R-1).
2. Parameter values come only from document 13, or from the contract surface in
   document 02.
3. The living documents stay true in the same session as any change (rule R-3).

Humans and agents alike: read [AGENTS.md](AGENTS.md), then [PLAN.md](PLAN.md),
then work.

## Contributing

This repository has no separate contributing guide, because
[AGENTS.md](AGENTS.md) is that guide for humans and agents alike. Read it first.
Then read [PLAN.md](PLAN.md) for the current focus.

Three things matter more here than in most repositories:

1. **Read the owning specification section before you write code.** Never guess a
   parameter value, a name, or a semantic.
2. **Never mark work done with a failing gate.** Report the failure verbatim
   instead.
3. **Use conventional commits with the milestone id**, as in
   `feat(ledger): split/merge families with per-branch supplies (A2)`.

## Security

Report vulnerabilities through GitHub's private reporting feature, and never
through a public issue or pull request. [`SECURITY.md`](SECURITY.md) gives the
full process and the response times.

Bleavit is financial infrastructure. Solvency-critical code carries adversarial
tests. It rounds against the claimant, and it defaults to the status quo on every
failure path.

## License

[GPL-3.0](LICENSE)

---

You theorized it, we are cooking it. Bon appétit, Prof. Hanson.
