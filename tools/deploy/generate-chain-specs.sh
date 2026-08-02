#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

# Honour CARGO_TARGET_DIR. The build below writes into it, so reading the
# artifacts back from a hardcoded `target/` silently looks in the wrong place —
# and on this project redirecting the target dir is not exotic, it is required
# (an ecryptfs $HOME hits a ~143-char filename cap during the wasm build). The
# failure mode is a bare "wasm blob shall be readable", which reads like a build
# error rather than a path error. `generate-client-chain-spec.sh` already does
# this; the two scripts now agree.
target_dir="${CARGO_TARGET_DIR:-target}"
wasm="$target_dir/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm"
builder="$target_dir/tools/bin/chain-spec-builder"
out="deploy/chain-specs/out"
properties="tokenSymbol=VIT,tokenDecimals=12,ss58Format=7777"
profile_tool="tools/release/runtime_profiles.py"
requested_profile=${RUNTIME_PROFILE:-}
profile_args=()
if [[ -n "$requested_profile" ]]; then
  profile_args=(--profile "$requested_profile")
fi
runtime_profile=$(python3 "$profile_tool" "${profile_args[@]}" --field name)
runtime_features=$(python3 "$profile_tool" --profile "$runtime_profile" --field features)

# Use the same explicit, defaults-disabled feature product as the release
# artifact. Rebuilding with Cargo defaults here would silently replace a
# phase-four/recovery Wasm before embedding it into the generated chain specs.
cargo build -p bleavit-runtime --release --no-default-features \
  --features "$runtime_features" --locked

# The pin is enforced by version, not mere presence: a stale binary left by an
# earlier train's pin (developer worktree, restored CI cache) must not silently
# generate specs that claim the new pin (Codex PR-#103 P2; same pattern as the
# cargo-audit guard in tools/ci/supply-chain-gates.sh).
builder_version="19.0.0"
if [[ ! -x "$builder" ]] || [[ "$("$builder" --version 2>/dev/null || true)" != *"$builder_version"* ]]; then
  cargo install staging-chain-spec-builder --version "$builder_version" --locked \
    --root "$target_dir/tools" --force
fi

mkdir -p "$out"

"$builder" --chain-spec-path "$out/bleavit-dev.json" create \
  --chain-name "Bleavit Development" \
  --chain-id bleavit_dev \
  -t development \
  --relay-chain paseo-local \
  --para-id 4242 \
  --runtime "$wasm" \
  --properties "$properties" \
  named-preset development

"$builder" --chain-spec-path "$out/bleavit-local.json" create \
  --chain-name "Bleavit Local" \
  --chain-id bleavit_local \
  -t local \
  --relay-chain paseo-local \
  --para-id 4242 \
  --runtime "$wasm" \
  --properties "$properties" \
  named-preset local_testnet

python3 tools/deploy/validate-chain-spec.py --profile dev "$out/bleavit-dev.json"
python3 tools/deploy/validate-chain-spec.py --profile local "$out/bleavit-local.json"
