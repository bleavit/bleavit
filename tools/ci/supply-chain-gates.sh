#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

summary_out=""
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || $1 != "--summary-out" || -z $2 ]]; then
    echo "usage: $0 [--summary-out <file>]" >&2
    exit 2
  fi
  summary_out=$2
fi

auditor="${BLEAVIT_AUDITOR:-$repo_root/target/tools/bin/cargo-audit}"
required_auditor_version="cargo-audit 0.22.2"
if [[ ! -x "$auditor" ]] || [[ "$($auditor --version 2>/dev/null || true)" != "$required_auditor_version" ]]; then
  cargo install cargo-audit --version 0.22.2 --locked --root target/tools
fi

# The audited set is DERIVED, never restated here. tools/ci/audited-workspaces.toml
# classifies every committed cargo lockfile, and this checker fails when the
# repository holds one the manifest does not (or the manifest holds one git does
# not track). The gate used to name `Cargo.lock` and `keeper/Cargo.lock` inline;
# `app/Cargo.lock` and `fuzz/Cargo.lock` arrived later and went unaudited behind a
# green job, because nothing compared the gate's list against the repository.
workspaces_manifest="${BLEAVIT_AUDITED_WORKSPACES:-$repo_root/tools/ci/audited-workspaces.toml}"
workspace_rows=$(python3 "$repo_root/tools/ci/check-audited-workspaces.py" \
  --manifest "$workspaces_manifest" --repo-root "$repo_root" --print)

assert_lockfile() {
  local lockfile=$1
  if [[ ! -f "$lockfile" ]]; then
    echo "required lockfile is missing: $lockfile" >&2
    return 1
  fi
  if ! git ls-files --error-unmatch -- "$lockfile" >/dev/null; then
    echo "required lockfile is not committed: $lockfile" >&2
    return 1
  fi
}

# Leg 1 — the committed-lockfile assertion (15 §4.5, TH-34).
#
# Every workspace resolves under ONE toolchain: the one the repository root
# selects. This leg asserts that a committed lockfile is complete and current for
# its manifests, which is a cargo resolution property rather than a compilation
# one, so running all four under the same cargo makes the four results
# comparable. It also keeps the leg cheap. The fuzz workspace pins its own
# nightly (`fuzz/rust-toolchain.toml`) for libFuzzer, and without this override
# rustup would download a full nightly toolchain here — including inside the
# Python-only CI job that runs `tools/release/tests` — for a check that never
# compiles anything. Measured equivalent: `cargo metadata --locked` on
# `fuzz/Cargo.lock` succeeds identically under the pinned nightly and under the
# root's stable channel. Compilation of that workspace stays on its own nightly,
# where `tools/ci/fuzz-gates.sh` owns it.
#
# If rustup is absent the override is skipped and each workspace falls back to
# whatever cargo the environment provides, which is the behavior before this
# leg grew past two workspaces.
metadata_toolchain=$(rustup show active-toolchain 2>/dev/null | head -1 | awk '{print $1}' || true)
while IFS=$'\t' read -r ws_name ws_dir ws_lockfile; do
  assert_lockfile "$ws_lockfile"
  (
    cd "$repo_root/$ws_dir"
    if [[ -n "$metadata_toolchain" ]]; then
      export RUSTUP_TOOLCHAIN="$metadata_toolchain"
    fi
    cargo metadata --locked --no-deps --format-version=1 >/dev/null
  )
done <<<"$workspace_rows"

# Leg 2 — RustSec, via the pinned cargo-audit.
#
# cargo-audit reads .cargo/audit.toml from its current working directory, so every
# workspace is audited FROM ITS OWN ROOT. That is doc 15 §4.5 clause 4
# (blast-radius containment) and not a convenience: a single run started here
# would apply the root workspace's annotated stable2606 exception set to all four
# lockfiles, and one workspace's pin-forced exception would then mask another
# workspace's real vulnerability. Only the root owns an exception file; the other
# three audit with none, which each run re-proves by reporting `settings.ignore`
# in the summary below.
#
# The first workspace refreshes the advisory database and the rest reuse it: the
# database is a process-wide clone under ~/.cargo/advisory-db, so re-fetching it
# per workspace would only add latency and flakiness.
audit_fetch_done=0
while IFS=$'\t' read -r ws_name ws_dir ws_lockfile; do
  echo "== cargo-audit: $ws_name ($ws_lockfile)"
  (
    cd "$repo_root/$ws_dir"
    if [[ $audit_fetch_done -eq 0 ]]; then
      "$auditor" audit
    else
      "$auditor" audit --no-fetch
    fi
  )
  audit_fetch_done=1
done <<<"$workspace_rows"

# Leg 3 — the GHSA-only complement.
#
# cargo-audit only sees what RustSec carries. For crates.io the GitHub Advisory
# Database is a strict superset — an advisory can have no RUSTSEC id at all, and
# the leg above is then blind to it rather than merely silent (yamux
# GHSA-vxx9-2994-q338, a HIGH remote panic, is the worked example). This leg
# gates exactly that complement via osv-scanner, which aggregates both DBs; see
# tools/ci/check-ghsa-only.py and tools/ci/ghsa-waivers.toml.
# shellcheck source=../env/pins.env
source "$repo_root/tools/env/pins.env"
# BLEAVIT_OSV_SCANNER is an explicit operator/test override and is trusted as
# given (same contract as BLEAVIT_AUDITOR above). The digest pin guards the
# binary this script fetches itself.
if [[ -n "${BLEAVIT_OSV_SCANNER:-}" ]]; then
  osv="$BLEAVIT_OSV_SCANNER"
else
  osv="$repo_root/target/tools/bin/osv-scanner"
  if [[ ! -x "$osv" ]] || [[ "$(sha256sum "$osv" | cut -d' ' -f1)" != "$OSV_SCANNER_SHA256" ]]; then
    mkdir -p "$(dirname "$osv")"
    curl --fail --silent --show-error --location --retry 3 --max-time 300 -o "$osv.tmp" \
      "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64"
    actual=$(sha256sum "$osv.tmp" | cut -d' ' -f1)
    if [[ "$actual" != "$OSV_SCANNER_SHA256" ]]; then
      rm -f "$osv.tmp"
      echo "osv-scanner digest mismatch for ${OSV_SCANNER_VERSION}: expected $OSV_SCANNER_SHA256, got $actual" >&2
      exit 1
    fi
    chmod +x "$osv.tmp"
    mv "$osv.tmp" "$osv"
  fi
fi
ghsa_args=()
while IFS=$'\t' read -r ws_name ws_dir ws_lockfile; do
  ghsa_args+=(--lockfile "$repo_root/$ws_lockfile")
done <<<"$workspace_rows"
python3 "$repo_root/tools/ci/check-ghsa-only.py" \
  --scanner "$osv" \
  --waivers "${BLEAVIT_GHSA_WAIVERS:-$repo_root/tools/ci/ghsa-waivers.toml}" \
  "${ghsa_args[@]}"

if [[ -n "$summary_out" ]]; then
  summary_tmp=$(mktemp -d)
  trap 'rm -rf "$summary_tmp"' EXIT
  summary_args=()
  while IFS=$'\t' read -r ws_name ws_dir ws_lockfile; do
    (
      cd "$repo_root/$ws_dir"
      "$auditor" audit --json --no-fetch >"$summary_tmp/$ws_name.json"
    )
    summary_args+=("$ws_name=$summary_tmp/$ws_name.json")
  done <<<"$workspace_rows"
  python3 - "$summary_out" \
    "${BLEAVIT_GHSA_WAIVERS:-$repo_root/tools/ci/ghsa-waivers.toml}" \
    "$repo_root/tools/ci/check-ghsa-only.py" \
    "${summary_args[@]}" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path

output = Path(sys.argv[1])
ghsa_waivers = Path(sys.argv[2])
checker_path = Path(sys.argv[3])
reports = [argument.split("=", 1) for argument in sys.argv[4:]]


def load(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"cargo-audit report is not an object: {path}")
    return value


def ignored_ids(report, name):
    ignored = report.get("settings", {}).get("ignore", [])
    if not isinstance(ignored, list) or any(not isinstance(item, str) for item in ignored):
        raise SystemExit(f"cargo-audit settings.ignore is not a string array for {name}")
    return sorted(ignored)


def warning_summary(report):
    warnings = report.get("warnings", {})
    if not isinstance(warnings, dict):
        raise SystemExit("cargo-audit warnings field is not an object")
    by_kind = {
        kind: len(rows)
        for kind, rows in sorted(warnings.items())
        if isinstance(rows, list) and rows
    }
    return {
        "allowed_warning_count": sum(by_kind.values()),
        "allowed_warnings_by_kind": by_kind,
    }


# SQ-135's disclosed-waiver property is "the FULL waived-ID list in every release
# manifest". v2 read the RustSec ignore list from the root workspace alone and
# named exactly two workspaces, so extending the gate to four would have quietly
# reduced it to a partial disclosure. v3 therefore reports each workspace's own
# ignore list AND the union across all of them, and the release assembler checks
# that the union really is one: a per-workspace exception missing from the
# top-level list is a release understating the risk it accepted.
workspaces = {}
union = set()
for name, path in reports:
    report = load(path)
    row = warning_summary(report)
    row["ignored_advisory_ids"] = ignored_ids(report, name)
    union.update(row["ignored_advisory_ids"])
    workspaces[name] = row

spec = importlib.util.spec_from_file_location("check_ghsa_only", checker_path)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
waived_ghsa_only = [
    {"id": identifier, "package": package, "version": version}
    for identifier, package, version in sorted(checker.load_waivers(ghsa_waivers))
]

summary = {
    "schema": "bleavit.supply-chain.v3",
    "ignored_advisory_ids": sorted(union),
    "waived_ghsa_only": waived_ghsa_only,
    "workspaces": workspaces,
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
fi
