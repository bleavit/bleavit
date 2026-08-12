#!/usr/bin/env bash
set -euo pipefail

# Build the primary and its exact terminal-recovery runtime in one immutable OCI
# environment.  build-runtime.sh is the in-container worker; keeping Docker here
# makes it impossible for an ordinary host invocation to emit evidence that
# falsely names the canonical image.
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

out_dir=${1:-release-work/runtime}
requested_profile=${2:-${RUNTIME_PROFILE:-}}
profile_tool=tools/release/runtime_profiles.py
profile_args=()
if [[ -n "$requested_profile" ]]; then
  profile_args=(--profile "$requested_profile")
fi
primary_profile=$(python3 "$profile_tool" "${profile_args[@]}" --field primary_profile)
recovery_profile=$(python3 "$profile_tool" --profile "$primary_profile" --field recovery_profile)
image=$(python3 "$profile_tool" --field build_image)
image_id=$(python3 "$profile_tool" --field build_image_id)
platform=$(python3 "$profile_tool" --field build_platform)
upstream_tag=$(python3 "$profile_tool" --field build_upstream_tag)
toolchain=$(python3 "$profile_tool" --field toolchain)
source_date_epoch=${SOURCE_DATE_EPOCH:-$(git show -s --format=%ct HEAD)}
if [[ ! "$source_date_epoch" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_DATE_EPOCH must be a non-negative integer" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for the digest-pinned runtime build" >&2
  exit 1
fi

mkdir -p "$out_dir"
out_dir=$(realpath "$out_dir")
scratch=$(mktemp -d "${TMPDIR:-/tmp}/bleavit-runtime-oci.XXXXXX")
cleanup() {
  if [[ -n "${scratch:-}" && -d "$scratch" ]]; then
    rm -rf -- "$scratch"
  fi
}
trap cleanup EXIT
mkdir -p "$scratch/home" "$scratch/cargo" "$scratch/rustup" "$scratch/target" "$scratch/tmp"

# Pulling by digest verifies every layer before execution.  The config id is a
# second binding to the exact image configuration (entrypoint, environment,
# user), not a mutable tag lookup.
docker pull --platform "$platform" "$image"
actual_image_id=$(docker image inspect --format '{{.Id}}' "$image")
if [[ "$actual_image_id" != "$image_id" ]]; then
  echo "runtime build image id $actual_image_id does not match reviewed $image_id" >&2
  exit 1
fi

docker run --rm --pull=never --platform "$platform" --read-only \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --workdir /src \
  --mount "type=bind,src=$repo_root,dst=/src,readonly" \
  --mount "type=bind,src=$out_dir,dst=/out" \
  --mount "type=bind,src=$scratch/home,dst=/build-home" \
  --mount "type=bind,src=$scratch/cargo,dst=/cargo-home" \
  --mount "type=bind,src=$scratch/rustup,dst=/rustup-home" \
  --mount "type=bind,src=$scratch/target,dst=/target" \
  --mount "type=bind,src=$scratch/tmp,dst=/tmp" \
  --env HOME=/build-home \
  --env CARGO_HOME=/cargo-home \
  --env RUSTUP_HOME=/rustup-home \
  --env CARGO_TARGET_DIR=/target \
  --env SOURCE_DATE_EPOCH="$source_date_epoch" \
  --env BLEAVIT_RUNTIME_BUILD_IMAGE="$image" \
  --env BLEAVIT_RUNTIME_BUILD_IMAGE_ID="$image_id" \
  --env BLEAVIT_RUNTIME_BUILD_PLATFORM="$platform" \
  --env BLEAVIT_RUNTIME_BUILD_UPSTREAM_TAG="$upstream_tag" \
  --env BLEAVIT_RUNTIME_BUILD_IN_CONTAINER=1 \
  --env BLEAVIT_PRIMARY_PROFILE="$primary_profile" \
  --env BLEAVIT_RECOVERY_PROFILE="$recovery_profile" \
  --env BLEAVIT_RUST_TOOLCHAIN="$toolchain" \
  "$image" bash -ceu '
    # The image is deliberately read-only.  Without --no-self-update rustup
    # installs the requested toolchain and then probes beside its own binary at
    # /usr/local/cargo/bin/updtest*, failing after a successful install because
    # that image path is immutable.
    rustup toolchain install "$BLEAVIT_RUST_TOOLCHAIN" --profile minimal --no-self-update \
      --component rustfmt --component clippy --component rust-analyzer \
      --target wasm32-unknown-unknown --target wasm32v1-none
    /src/tools/release/build-runtime.sh /out "$BLEAVIT_PRIMARY_PROFILE"
    /src/tools/release/build-runtime.sh /out/recovery "$BLEAVIT_RECOVERY_PROFILE"
  '

for artifact in runtime.wasm build-info.json recovery/runtime.wasm recovery/build-info.json; do
  if [[ ! -f "$out_dir/$artifact" ]]; then
    echo "OCI runtime build did not produce $out_dir/$artifact" >&2
    exit 1
  fi
done

echo "digest-pinned runtime pair written to $out_dir"
