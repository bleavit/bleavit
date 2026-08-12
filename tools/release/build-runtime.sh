#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

out_dir=${1:-release-work/runtime}
requested_profile=${2:-${RUNTIME_PROFILE:-}}
# Honour CARGO_TARGET_DIR: AGENTS.md *requires* redirecting it off $HOME on an ecryptfs
# workstation (the ~143-char filename cap kills the release+benchmarks build), so a
# hardcoded `target/` makes this script unusable under the very setup the manual
# mandates — cargo writes to the redirected dir and the copy below then reports the wasm
# "was not produced". Same defect `tools/ci/regenerate-weights.py` carries a `--runtime`
# flag for; here the env var is enough, since cargo already honours it.
wasm_source="${CARGO_TARGET_DIR:-target}/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm"
profile_tool="tools/release/runtime_profiles.py"
profile_args=()
if [[ -n "$requested_profile" ]]; then
  profile_args=(--profile "$requested_profile")
fi
profile=$(python3 "$profile_tool" "${profile_args[@]}" --field name)
base_profile=$(python3 "$profile_tool" --profile "$profile" --field base)
features=$(python3 "$profile_tool" --profile "$profile" --field features)
recovery=$(python3 "$profile_tool" --profile "$profile" --field recovery)
multi_block_migrations=$(python3 "$profile_tool" --profile "$profile" --field multi_block_migrations)
recipe=$(python3 "$profile_tool" --profile "$profile" --field recipe)
recovery_test_recipe=$(python3 "$profile_tool" --profile "$profile" --field recovery_test_recipe)
toolchain=$(python3 "$profile_tool" --field toolchain)

# This worker may only emit a build record from the reviewed OCI wrapper.  The
# wrapper pulls by manifest digest and verifies the image config id before
# starting the container; these equality checks bind that executed identity to
# build-info rather than trusting caller-supplied descriptive text.
expected_image=$(python3 "$profile_tool" --field build_image)
expected_image_id=$(python3 "$profile_tool" --field build_image_id)
expected_platform=$(python3 "$profile_tool" --field build_platform)
expected_upstream_tag=$(python3 "$profile_tool" --field build_upstream_tag)
if [[ "${BLEAVIT_RUNTIME_BUILD_IN_CONTAINER:-}" != "1" || ! -f /.dockerenv ]]; then
  echo "build-runtime.sh is an OCI worker; run tools/release/build-runtime-oci.sh" >&2
  exit 1
fi
for binding in \
  "BLEAVIT_RUNTIME_BUILD_IMAGE:$expected_image" \
  "BLEAVIT_RUNTIME_BUILD_IMAGE_ID:$expected_image_id" \
  "BLEAVIT_RUNTIME_BUILD_PLATFORM:$expected_platform" \
  "BLEAVIT_RUNTIME_BUILD_UPSTREAM_TAG:$expected_upstream_tag"; do
  variable=${binding%%:*}
  expected=${binding#*:}
  if [[ "${!variable:-}" != "$expected" ]]; then
    echo "$variable does not match the reviewed runtime build environment" >&2
    exit 1
  fi
done

if [[ ! "${BLEAVIT_SOURCE_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BLEAVIT_SOURCE_COMMIT must be a 40-character lowercase Git object id" >&2
  exit 1
fi
if [[ ! "${SOURCE_DATE_EPOCH:-}" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_DATE_EPOCH must be a non-negative integer" >&2
  exit 1
fi
export SOURCE_DATE_EPOCH
export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export CARGO_INCREMENTAL=0
export CARGO_TERM_COLOR=never
# substrate-wasm-builder cannot locate the workspace lockfile from the
# wrapper's out-of-tree /target without this canonical source-root hint.
export WASM_BUILD_WORKSPACE_HINT="$repo_root"

cargo build -p bleavit-runtime --release --no-default-features --features "$features" --locked

# A recovery artifact is admissible only after the runtime proves that the
# exact same base+recovery feature set registers zero multi-block migrations.
# Cargo returns success for a filter that runs zero tests, so also require the
# harness summary to report one passing test.
profile_verification_result=""
if [[ "$recovery" == "true" ]]; then
  test_features=${features/,substrate-wasm-builder/}
  test_features=${test_features/,metadata-hash/}
  verification_log=$(mktemp)
  trap 'rm -f "$verification_log"' EXIT
  cargo test -p bleavit-runtime --no-default-features --features "$test_features" \
    --locked recovery_profile_has_zero_multi_block_migrations 2>&1 | tee "$verification_log"
  passing_summaries=$(grep -Ec 'test result: ok\. 1 passed; 0 failed;' "$verification_log" || true)
  if [[ "$passing_summaries" != "1" ]]; then
    echo "recovery profile did not execute exactly one zero-MBM proof test" >&2
    exit 1
  fi
  profile_verification_result="passed"
fi

if [[ ! -f "$wasm_source" ]]; then
  echo "runtime wasm was not produced at $wasm_source" >&2
  exit 1
fi

mkdir -p "$out_dir"
cp "$wasm_source" "$out_dir/runtime.wasm"

TOOLCHAIN="$toolchain" OUT_DIR="$out_dir" RUNTIME_PROFILE="$profile" \
BASE_PROFILE="$base_profile" CARGO_FEATURES="$features" RECOVERY="$recovery" \
MULTI_BLOCK_MIGRATIONS="$multi_block_migrations" RECIPE="$recipe" \
RECOVERY_TEST_RECIPE="$recovery_test_recipe" \
PROFILE_VERIFICATION_RESULT="$profile_verification_result" \
BUILD_IMAGE="$expected_image" BUILD_IMAGE_ID="$expected_image_id" \
BUILD_PLATFORM="$expected_platform" BUILD_UPSTREAM_TAG="$expected_upstream_tag" \
python3 - <<'PY'
import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path

out_dir = Path(os.environ["OUT_DIR"])
wasm = out_dir / "runtime.wasm"

def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()

rustc_verbose = command("rustc", "-vV")
host = next(
    (line.split(":", 1)[1].strip() for line in rustc_verbose.splitlines() if line.startswith("host:")),
    platform.machine(),
)
commit = os.environ["BLEAVIT_SOURCE_COMMIT"]
digest = hashlib.sha256(wasm.read_bytes()).hexdigest()
info = {
    "schema": "bleavit.runtime-build.v3",
    "git_commit": commit,
    "source_date_epoch": int(os.environ["SOURCE_DATE_EPOCH"]),
    "toolchain": os.environ["TOOLCHAIN"],
    "host_triple": host,
    "cargo_version": command("cargo", "--version"),
    "rustc_version": command("rustc", "--version"),
    "rustc_verbose_version": rustc_verbose,
    "wasm": {
        "path": "runtime.wasm",
        "sha256": digest,
        "size": wasm.stat().st_size,
    },
    "runtime_profile": os.environ["RUNTIME_PROFILE"],
    "base_profile": os.environ["BASE_PROFILE"],
    "recovery": os.environ["RECOVERY"] == "true",
    "cargo_default_features": False,
    "cargo_features": os.environ["CARGO_FEATURES"].split(","),
    "multi_block_migrations": os.environ["MULTI_BLOCK_MIGRATIONS"],
    "recipe": os.environ["RECIPE"],
    "profile_verification": (
        {
            "command": os.environ["RECOVERY_TEST_RECIPE"],
            "result": os.environ["PROFILE_VERIFICATION_RESULT"],
            "test": "recovery_profile_has_zero_multi_block_migrations",
        }
        if os.environ["RECOVERY"] == "true"
        else None
    ),
    "normalized_environment": {
        "CARGO_HOME": os.environ["CARGO_HOME"],
        "CARGO_INCREMENTAL": os.environ["CARGO_INCREMENTAL"],
        "CARGO_TARGET_DIR": os.environ["CARGO_TARGET_DIR"],
        "CARGO_TERM_COLOR": os.environ["CARGO_TERM_COLOR"],
        "HOME": os.environ["HOME"],
        "LANG": os.environ["LANG"],
        "LC_ALL": os.environ["LC_ALL"],
        "RUSTUP_HOME": os.environ["RUSTUP_HOME"],
        "SOURCE_DATE_EPOCH": os.environ["SOURCE_DATE_EPOCH"],
        "TZ": os.environ["TZ"],
        "WASM_BUILD_WORKSPACE_HINT": os.environ["WASM_BUILD_WORKSPACE_HINT"],
    },
    "build_environment": {
        "image": os.environ["BUILD_IMAGE"],
        "image_id": os.environ["BUILD_IMAGE_ID"],
        "kind": "oci",
        "platform": os.environ["BUILD_PLATFORM"],
        "upstream_tag": os.environ["BUILD_UPSTREAM_TAG"],
    },
    "reproducibility_scope": (
        "same source + canonical recipe + exact OCI image digest => same runtime bytes; "
        "independent runtime byte comparison is not yet automated"
    ),
    "rfc78_metadata_hash": {
        "enabled": True,
        "token_symbol": "VIT",
        "token_decimals": 12,
        "source": "RUNTIME_METADATA_HASH embedded by substrate-wasm-builder",
    },
}
(out_dir / "build-info.json").write_text(
    json.dumps(info, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

echo "runtime release inputs for profile $profile written to $out_dir"
