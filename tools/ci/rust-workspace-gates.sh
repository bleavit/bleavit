#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: tools/ci/rust-workspace-gates.sh [--changed [PACKAGE...]]

With no arguments, run the exhaustive Rust workspace gate.  --changed runs
fmt plus clippy/tests only for packages changed against RUST_GATE_BASE (or
origin/main), and accepts explicit package names to form a local shard.  The
reduced mode is a feedback loop, not a replacement for the exhaustive gate.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

# Avoid duplicate local Cargo work. CI remains free to fan out its independent
# jobs, while two developers (or two shells) cannot accidentally compile the
# same full workspace concurrently on one checkout.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${TMPDIR:-/tmp}/bleavit-rust-workspace-gates.lock"
  if ! flock -n 9; then
    echo "Another rust-workspace-gates.sh invocation is already running; refusing a duplicate Cargo job." >&2
    exit 2
  fi
fi

if [[ "${1:-}" == "--changed" ]]; then
  shift
  if [[ $# -gt 0 ]]; then
    changed_packages=("$@")
  else
    gate_base="${RUST_GATE_BASE:-origin/main}"
    mapfile -t changed_packages < <(python3 - "$gate_base" <<'PY'
import json
import os
import subprocess
import sys

base = sys.argv[1]
try:
    files = subprocess.check_output(
        ["git", "diff", "--name-only", base], text=True
    ).splitlines()
except subprocess.CalledProcessError:
    files = subprocess.check_output(
        ["git", "diff", "--name-only"], text=True
    ).splitlines()

meta = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--locked", "--no-deps", "--format-version=1"],
    text=True,
))
cwd = os.getcwd()
for package in meta["packages"]:
    root = os.path.dirname(os.path.relpath(package["manifest_path"], cwd))
    if any(path == root or path.startswith(root + os.sep) for path in files):
        print(package["name"])
PY
    )
  fi

  if [[ ${#changed_packages[@]} -eq 0 ]]; then
    echo "Changed-scope Rust gate: no workspace packages changed; nothing to compile."
    exit 0
  fi

  package_args=()
  for package in "${changed_packages[@]}"; do
    package_args+=( -p "$package" )
  done
  echo "Changed-scope Rust gate: ${changed_packages[*]}"
  cargo fmt --all -- --check
  cargo clippy --all-targets --locked "${package_args[@]}" -- -D warnings
  cargo test --all-targets --locked "${package_args[@]}"
  exit 0
fi

if [[ $# -gt 0 ]]; then
  usage >&2
  exit 2
fi

# Native node dependencies use bindgen. Point it at LLVM's library directory
# when distributions do not install an unversioned libclang in the default path.
if [[ -z "${LIBCLANG_PATH:-}" ]] && command -v llvm-config >/dev/null 2>&1; then
  export LIBCLANG_PATH="$(llvm-config --libdir)"
fi

# Networked RustSec checks run in supply-chain-gates.sh; this offline-friendly
# workspace gate still enforces the committed lockfile on every cargo command.
member_count=$(cargo metadata --locked --no-deps --format-version=1 | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["workspace_members"]))')

if [[ "$member_count" == "0" ]]; then
  echo "Rust workspace has no member crates yet; fmt/clippy/test gates are armed in CI and will run once members are added."
  exit 0
fi

# A `cargo test` filter is a **substring match**, and a filter that matches
# nothing exits 0 with `test result: ok. 0 passed; … N filtered out`. So a leg
# added precisely to stop a suite falling out of every gate can itself fall out
# of every gate, silently, the moment somebody renames the module it names —
# and the renamer sees nothing but green. The same shape hides a feature gate
# that stopped selecting anything.
#
# Every filtered or feature-selected leg below therefore runs through this: tee
# the output, sum the `passed` counts across the run's test binaries, and refuse
# a total under the floor the leg declares. Same countermeasure as
# `tools/ci/runtime-profile-gates.sh`, which asserts on its zero-MBM proof.
#
# The floor is a **minimum**, not an equality: adding a test to a covered family
# must not break the gate, while deleting the last one must.
gate_log="$(mktemp)"
trap 'rm -f "$gate_log"' EXIT

assert_selected_tests_ran() {
  local label="$1"
  local minimum="$2"
  shift 2
  # `set -o pipefail` is in force, so a failing cargo aborts the script here.
  "$@" 2>&1 | tee "$gate_log"
  local summaries passed
  summaries=$(grep -Ec '^test result: (ok|FAILED)\.' "$gate_log" || true)
  passed=$(sed -nE 's/^test result: ok\. ([0-9]+) passed;.*/\1/p' "$gate_log" \
    | awk '{total += $1} END {print total + 0}')
  if [[ "$summaries" -eq 0 ]]; then
    echo "$label: the run produced no test-result summary at all." >&2
    echo "  Nothing was executed, and a gate that executes nothing cannot pass." >&2
    exit 1
  fi
  if [[ "$passed" -lt "$minimum" ]]; then
    echo "$label: selected $passed test(s); at least $minimum must run." >&2
    echo "  A cargo test filter is a substring match, and matching nothing exits 0." >&2
    echo "  Either the filter no longer names the suite, or the feature gate no" >&2
    echo "  longer selects it. Fix the leg — do not lower the floor." >&2
    exit 1
  fi
}

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# Weight-regression gate (15 §4.5). The authoritative enforcement is the
# dedicated `Weight regression` CI job, which checks out with `fetch-depth: 0`
# precisely so the comparison base resolves. It is repeated here so a *local*
# gate run cannot miss it — batch X wave 1 shipped a red weight gate exactly
# because this script did not run it and the separate job was not consulted.
#
# The checker's default base is `git merge-base HEAD origin/main`, and the Rust
# CI job uses a shallow single-commit checkout where `origin/main` does not
# exist. Skip loudly there rather than failing the canonical Rust gate on an
# unfetched ref — the dedicated job still enforces it.
if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  python3 tools/ci/check-weight-regression.py
else
  echo "SKIP: weight-regression gate — 'origin/main' is not present in this checkout."
  echo "      Enforced by the 'Weight regression' CI job (fetch-depth: 0)."
  echo "      To run it here: git fetch origin main, or pass --base <rev> yourself."
fi
python3 tools/ci/check-weight-storage-bounds.py
# 15 §4.5: generated weight files hold only generated weights. The growth-only
# regression gate above cannot see a hand-written term being deleted by a
# regeneration, because that reads as a *decrease* (SQ-490).
python3 tools/ci/check-generated-weights.py

# B6 release gate (09 §2.1(5)): compile the deployable runtime and its
# benchmarking surface, then compile and execute the runtime's genesis-state
# `TryRuntime_on_runtime_upgrade` + try-state coverage. The live-chain snapshot
# `try-runtime-cli` leg mandated by 15 §4.7 lands with the B7/B8 environment
# and release-artifact work; this local leg does not claim snapshot coverage.
cargo build -p bleavit-runtime --release --locked
cargo build -p bleavit-runtime --release --features runtime-benchmarks --locked
cargo build -p bleavit-runtime --features try-runtime --locked
cargo test -p bleavit-runtime --features try-runtime --locked

# The same feature, one layer down, where nothing ran it at all. A
# `#[cfg(feature = "try-runtime")]` test in a *pallet* crate was in no gate:
# `cargo test --workspace` above is default-feature, the `cargo test -p
# bleavit-runtime --features try-runtime` line immediately above selects only
# that crate's targets, and `runtime-profile-gates.sh` uses the feature
# for `clippy --lib` and `cargo check`, neither of which compiles a
# `#[cfg(test)]` module. So they neither executed nor compiled, and a compile
# break in them was equally invisible — the third instance of that defect class
# in a branch that fixed it one layer up.
#
# Measured, not assumed: `pallet-futarchy-treasury` runs 113 tests by default
# and 120 with the feature, and `pallet-origins` 19 and 20. What was ungated in
# the treasury is the v3→v4 state-preservation arm and the idempotent-latch arm
# — the two that separate a migration that did the right thing from one that
# merely bumped the version. The whole crate runs rather than a filter, because
# the point is that it *compiles* under the feature too; the probe after each
# then proves the gated tests are the ones that ran, since a crate whose
# feature-gated tests all vanished would still report a green suite.
cargo test -p pallet-futarchy-treasury --features try-runtime --locked
assert_selected_tests_ran "pallet-futarchy-treasury try-runtime tests" 7 \
  cargo test -p pallet-futarchy-treasury --features try-runtime --locked try_runtime
cargo test -p pallet-origins --features try-runtime --locked
assert_selected_tests_ran "pallet-origins try-runtime tests" 1 \
  cargo test -p pallet-origins --features try-runtime --locked stateless_try_state_is_green

# The same class one feature over, found while fixing the two above. Until
# 2026-08-11 `cargo test -p pallet-trading-rewards --features runtime-benchmarks`
# did not COMPILE (E0437/E0576 on the mock's `derive_impl` line), so this
# pallet's `impl_benchmark_test_suite!` had never executed a single benchmark —
# and nothing reported it, because no gate ran the command. The cause was a
# missing `pallet-assets/runtime-benchmarks` in the crate's own feature list.
# The suite goes 91 -> 97 tests under the feature, and those six are the
# benchmarks. The floor is the benchmark count: it fails if a benchmark is
# deleted, and `--no-fail-fast` is not used because a benchmark that panics
# should stop the gate.
#
# **This is repo-wide and only this pallet is fixed (SQ-1054).** Five other
# mocks use the same `derive_impl(pallet_assets::config_preludes::…)` and fail
# identically — `pallet-client-registry` was verified to. Fixing them is that
# question's job, not this branch's.
assert_selected_tests_ran "pallet-trading-rewards benchmark tests" 6 \
  cargo test -p pallet-trading-rewards --features runtime-benchmarks --locked benchmark

# TR7 fix round, Important 1: a `#[cfg(feature = "runtime-benchmarks")]` test
# module is otherwise in no gate at all. `cargo build -p bleavit-runtime
# --release --features runtime-benchmarks` above only *builds* that feature
# (a `cargo build` never runs a `#[cfg(test)]` fn), and
# `tools/ci/runtime-profile-gates.sh` below uses it only for `clippy --lib`
# and `cargo check`. So `tests_trading_rewards::
# the_trade_and_settlement_fixtures_really_prime_the_expensive_arms` — written
# specifically to catch a benchmark fixture that silently starts declining,
# which would regenerate a *cheaper* weight the growth-only regression gate
# cannot see — compiled and passed by hand and was never once exercised by a
# gate. Confirmed by mutating `prime_settled_market` to return `false`: 16 of
# 17 `tests_trading_rewards` tests still passed, and nothing before this line
# would have noticed.
#
# Scoped to `tests_trading_rewards`, not the whole crate, on direct evidence:
# the unscoped `cargo test -p bleavit-runtime --features runtime-benchmarks
# --locked` deterministically fails 71 pre-existing tests (408 passed, 71
# failed, identical failing set across two runs) that have nothing to do with
# this pallet — `tests_welfare_inputs::*` and unrelated `tests::*` governance/
# treasury/coretime end-to-end flows. The failures are conditional on the
# feature alone: the same crate passes all of its tests without it, and this
# branch's whole `tests.rs` diff names none of the 71.
#
# **The cause is only partly identified, and this comment used to claim
# otherwise.** `RuntimeMetricInputs::onchain_components` (`configs.rs`) has
# carried a `#[cfg(feature = "runtime-benchmarks")]` branch that fabricates
# welfare metric components (a fixed interior `FixedU64(930_000_000)`, by
# design — see its own comment) instead of computing them, since PR #177 /
# #191 (A14, 2026-07-26), weeks before TR7 existed. That explains **8** of the
# 71, all in `tests_welfare_inputs` — measured by neutralizing the fabrication
# under `cfg(test)` and re-running, which took the count 71 -> 63, not by
# reading the code and inferring. **The other 63 have some other cause that no
# one has identified.** Do not read this comment as saying that one repair
# reopens full-crate scope; it does not.
#
# Fixing any of it is a separate undertaking; running the unscoped suite here
# would turn this gate red for a reason no trading-rewards change caused.
# Tracked as SQ-1053, which owns the decision: either the fabrication is a
# legitimate measurement artifact and this leg can only ever be an opted-in
# module list, or it is a defect and both crates get
# repaired. `pallet-oracle` sits in the same blind spot (`bench_report`,
# found independently by #299 the same day). Full failing-test list is in
# the TR7 fix-round findings.
#
# **Scoping it to a module name is what makes the count assertion mandatory.**
# `tests_trading_rewards` is a substring filter, so renaming `mod
# tests_trading_rewards;` and its file leaves this leg matching nothing, exiting
# 0, and putting the whole suite back in no gate — the exact state the comment
# above exists to end, restored silently by an ordinary refactor.
assert_selected_tests_ran "bleavit-runtime runtime-benchmarks trading-rewards suite" 1 \
  cargo test -p bleavit-runtime --features runtime-benchmarks --locked tests_trading_rewards

# B16 deployable-image matrix. Every profile compiles and tests with Cargo
# defaults disabled; recovery profiles additionally execute the runtime's
# exact zero-multi-block-migrations proof under their own base feature.
tools/ci/runtime-profile-gates.sh

# Real no_std build gate: the frame-free math surface (futarchy-primitives,
# futarchy-fixed, trading-rewards-core) must compile without std (01 §5.2 /
# rule 9). A --no-default-features `cargo test` executes zero tests and so
# silently passes; a build does not.
if cargo metadata --locked --no-deps --format-version=1 \
  | python3 -c 'import json,sys; ms={m["name"] for m in json.load(sys.stdin)["packages"]}; sys.exit(0 if {"futarchy-primitives","futarchy-fixed","trading-rewards-core"} <= ms else 1)'; then
  cargo build -p futarchy-primitives -p futarchy-fixed -p trading-rewards-core --no-default-features --locked
fi

# I-24 XCM-isolation lint (15 §1, rule 7): `xcm`/`pallet-xcm` types must never be
# imported by the decision/settlement pallets or their frame-free cores; in the
# oracle the only permitted XCM-adjacent surface is the reserve-probe
# `QueryResponse` *handler seam* (`reserve_probe_result`, 07 §8), which needs no
# xcm imports either — so the deny list covers oracle too. Word-boundary match
# catches `use xcm...`, `staging_xcm...`, `pallet_xcm...` in code and manifests;
# `cumulus-primitives-core` is denied too (it re-exports XCM types — a smuggling
# path). This enforces the *import* half of the 15 §1 lint; the "XCM-derived
# storage reads" half is not grep-detectable and stays review-enforced (I-24 is
# convention-class — 15 §1).
i24_paths=(
  pallets/epoch pallets/welfare pallets/market pallets/conditional-ledger pallets/oracle
  crates/epoch-core crates/welfare-core crates/market-core crates/conditional-ledger-core crates/oracle-core
)
i24_existing=()
for p in "${i24_paths[@]}"; do [[ -d "$p" ]] && i24_existing+=("$p"); done
if [[ ${#i24_existing[@]} -gt 0 ]]; then
  if grep -rnE '(^|[^a-zA-Z0-9_-])(staging[-_]xcm|pallet[-_]xcm|xcm_executor|xcm_builder|cumulus[-_]primitives[-_]core)([^a-zA-Z0-9_-]|$)|^\s*use xcm' \
      "${i24_existing[@]}" --include='*.rs' --include='Cargo.toml'; then
    echo "I-24 violation: xcm import found in a decision/settlement pallet (15 §1, runtime-code rule 7)" >&2
    exit 1
  fi
fi

# Off-chain keeper reference implementation (B9): a separate cargo workspace so
# subxt's dependency tree cannot perturb the runtime workspace's `=`-exact pins.
if [[ -d keeper ]]; then
  (
    cd keeper
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
    cargo test --workspace --locked
  )
fi

if [[ -d reference-model/tests ]]; then
  PYTHONPATH=reference-model/src python3 -m unittest discover -s reference-model/tests
fi

if [[ -f tools/reference-model/generate-vectors.py ]]; then
  python3 tools/reference-model/generate-vectors.py --check
fi

python3 tools/reference-model/check-doc-table.py

# I-22 convention gate (15 §4.6): the strict extractor fails on registry drift,
# and every classified dispatch limit must remain attached to a Rust test.
python3 -m unittest discover -s tools/limit-coverage/tests
python3 tools/limit-coverage/check-limit-coverage.py
