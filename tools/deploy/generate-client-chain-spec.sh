#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

wasm="${CARGO_TARGET_DIR:-target}/release/wbuild/bleavit-client-runtime/bleavit_client_runtime.compact.compressed.wasm"
builder="${CARGO_TARGET_DIR:-target}/tools/bin/chain-spec-builder"
out="zombienet/specs/out"

# The client runtime is a separate harness product. It is never linked into
# bleavit-runtime; the shared omni-node selects this Wasm from the client
# chain-spec at boot.
export WASM_BUILD_WORKSPACE_HINT="$repo_root"
cargo build -p bleavit-client-runtime --release --locked

builder_version="19.0.0"
if [[ ! -x "$builder" ]] || [[ "$($builder --version 2>/dev/null || true)" != *"$builder_version"* ]]; then
  cargo install staging-chain-spec-builder --version "$builder_version" --locked --root "${CARGO_TARGET_DIR:-target}/tools" --force
fi

mkdir -p "$out"
"$builder" --chain-spec-path "$out/bleavit-client-local.json" create \
  --chain-name "Bleavit Client Integration Para" \
  --chain-id bleavit_client_local \
  -t local \
  --relay-chain paseo-local \
  --para-id 4343 \
  --runtime "$wasm" \
  --properties "tokenSymbol=CLT,tokenDecimals=12,ss58Format=7778" \
  named-preset local_testnet

echo "wrote $out/bleavit-client-local.json"
