#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

runtime_wasm=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-wasm)
      if [[ $# -lt 2 ]]; then
        echo "--runtime-wasm requires a path" >&2
        exit 2
      fi
      runtime_wasm=$2
      shift 2
      ;;
    --help)
      echo "usage: $0 [--runtime-wasm PATH]"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# Honour CARGO_TARGET_DIR. The build below writes into it, so reading the
# artifacts back from a hardcoded `target/` silently looks in the wrong place —
# and on this project redirecting the target dir is not exotic, it is required
# (an ecryptfs $HOME hits a ~143-char filename cap during the wasm build). The
# failure mode is a bare "wasm blob shall be readable", which reads like a build
# error rather than a path error. `generate-client-chain-spec.sh` already does
# this; the two scripts now agree.
target_dir="${CARGO_TARGET_DIR:-target}"
builder="$target_dir/tools/bin/chain-spec-builder"
out="deploy/chain-specs/out"
properties="tokenSymbol=VIT,tokenDecimals=12,ss58Format=7777"

if [[ -n "$runtime_wasm" ]]; then
  # Release assembly must embed the exact primary bytes already produced by the
  # digest-pinned OCI build. Rebuilding here is not a reproducibility check: it
  # substitutes a host-built runtime into the chain specs and makes metadata
  # extraction target a different artifact from the one the release ships.
  if [[ ! -f "$runtime_wasm" || ! -s "$runtime_wasm" ]]; then
    echo "--runtime-wasm must name a non-empty regular file: $runtime_wasm" >&2
    exit 1
  fi
  wasm=$(realpath -- "$runtime_wasm")
else
  wasm="$target_dir/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm"
  profile_tool="tools/release/runtime_profiles.py"
  requested_profile=${RUNTIME_PROFILE:-}
  profile_args=()
  if [[ -n "$requested_profile" ]]; then
    profile_args=(--profile "$requested_profile")
  fi
  runtime_profile=$(python3 "$profile_tool" "${profile_args[@]}" --field name)
  runtime_features=$(python3 "$profile_tool" --profile "$runtime_profile" --field features)

  # Developer mode builds the same explicit, defaults-disabled feature product
  # selected by the reviewed runtime profile. Release mode takes the branch
  # above and never replaces the OCI artifact with host output.
  cargo build -p bleavit-runtime --release --no-default-features \
    --features "$runtime_features" --locked
fi

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
