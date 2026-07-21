#!/usr/bin/env bash
# Fetch the B7 native-provider binaries — 15 §4.7; 02 §11; 01 §9.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=pins.env
source "$repo_root/tools/env/pins.env"

host="$(uname -s)-$(uname -m)"
if [[ "$host" != "Linux-x86_64" ]]; then
  echo "unsupported host for the pinned release binaries: $host" >&2
  echo "B7 supports linux-x86_64 only; build the pinned sources in tools/env/pins.env for this host instead." >&2
  exit 1
fi
zombienet_asset="zombienet-linux-x64"

out="$repo_root/zombienet/bin"
mkdir -p "$out"

sha256_file() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

download_to_temp() {
  local url=$1
  local temporary=$2
  rm -f "$temporary"
  curl --fail --location --retry 3 --output "$temporary" "$url"
}

finish_verified() {
  local url=$1
  local temporary=$2
  local destination=$3
  local expected=$4
  if [[ ! "$expected" =~ ^[0-9a-fA-F]{64}$ ]]; then
    rm -f "$temporary"
    echo "malformed expected SHA-256 for $url" >&2
    exit 1
  fi
  local actual
  actual=$(sha256_file "$temporary")
  if [[ "${actual,,}" != "${expected,,}" ]]; then
    rm -f "$temporary"
    echo "SHA-256 mismatch for $url: expected $expected, got $actual" >&2
    exit 1
  fi
  mv "$temporary" "$destination"
  chmod +x "$destination"
}

# polkadot-sdk releases publish per-asset .sha256 sidecars.
download_verified() {
  local url=$1
  local destination=$2
  local temporary="${destination}.part"
  local sidecar="${temporary}.sha256"
  download_to_temp "$url" "$temporary"
  if ! curl --fail --location --retry 3 --output "$sidecar" "${url}.sha256"; then
    rm -f "$temporary" "$sidecar"
    echo "missing published SHA-256 sidecar for $url" >&2
    exit 1
  fi
  local expected
  expected=$(awk 'NR == 1 { print $1 }' "$sidecar")
  rm -f "$sidecar"
  finish_verified "$url" "$temporary" "$destination" "$expected"
}

# zombienet publishes no .sha256 sidecars; its digest is pinned in pins.env.
download_pinned() {
  local url=$1
  local destination=$2
  local expected=$3
  local temporary="${destination}.part"
  download_to_temp "$url" "$temporary"
  finish_verified "$url" "$temporary" "$destination" "$expected"
}

sdk_release="https://github.com/paritytech/polkadot-sdk/releases/download/${POLKADOT_SDK_TAG}"
for binary in polkadot polkadot-prepare-worker polkadot-execute-worker polkadot-parachain; do
  download_verified "${sdk_release}/${binary}" "$out/$binary"
done

download_pinned \
  "https://github.com/paritytech/zombienet/releases/download/${ZOMBIENET_VERSION}/${zombienet_asset}" \
  "$out/zombienet" \
  "$ZOMBIENET_SHA256"

# try-runtime-cli drives the mandatory closing --checks try-state leg (15 §1;
# SQ-204). It publishes no .sha256 sidecar, so its digest is pinned in pins.env.
download_pinned \
  "https://github.com/paritytech/try-runtime-cli/releases/download/${TRY_RUNTIME_VERSION}/try-runtime-x86_64-unknown-linux-musl" \
  "$out/try-runtime" \
  "$TRY_RUNTIME_SHA256"
