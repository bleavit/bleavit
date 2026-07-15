#!/usr/bin/env bash
set -euo pipefail

member_count=$(cargo metadata --no-deps --format-version=1 | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["workspace_members"]))')

if [[ "$member_count" == "0" ]]; then
  echo "Rust workspace has no member crates yet; fmt/clippy/test gates are armed in CI and will run once members are added."
  exit 0
fi

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Real no_std build gate: the frame-free math surface (futarchy-primitives,
# futarchy-fixed) must compile without std (01 §5.2 / rule 9). A --no-default-features
# `cargo test` executes zero tests and so silently passes; a build does not.
if cargo metadata --no-deps --format-version=1 \
  | python3 -c 'import json,sys; ms={m["name"] for m in json.load(sys.stdin)["packages"]}; sys.exit(0 if {"futarchy-primitives","futarchy-fixed"} <= ms else 1)'; then
  cargo build -p futarchy-primitives -p futarchy-fixed --no-default-features
fi

if [[ -d reference-model/tests ]]; then
  PYTHONPATH=reference-model/src python3 -m unittest discover -s reference-model/tests
fi

if [[ -f tools/reference-model/generate-vectors.py ]]; then
  python3 tools/reference-model/generate-vectors.py --check
fi

python3 tools/reference-model/check-doc-table.py
