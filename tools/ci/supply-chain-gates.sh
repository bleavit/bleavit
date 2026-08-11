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
# classifies every committed lockfile in every ecosystem, and this checker fails
# when the repository holds one the manifest does not (or the manifest holds one
# git does not track). The gate used to name `Cargo.lock` and `keeper/Cargo.lock`
# inline; `app/Cargo.lock` and `fuzz/Cargo.lock` arrived later and went unaudited
# behind a green job, because nothing compared the gate's list against the
# repository. `app/pnpm-lock.yaml` was the same hole one ecosystem over and
# outlived the cargo one, because a checker that only listed `*Cargo.lock` could
# not have found it however carefully it compared (SQ-985).
#
# Rows are filtered by ecosystem HERE and never inside the checker's coverage
# assertion, which always spans every row. Narrowing the work list must never
# narrow what the repository is checked against.
workspaces_manifest="${BLEAVIT_AUDITED_WORKSPACES:-$repo_root/tools/ci/audited-workspaces.toml}"
workspace_rows=$(python3 "$repo_root/tools/ci/check-audited-workspaces.py" \
  --manifest "$workspaces_manifest" --repo-root "$repo_root" --print --ecosystem cargo)
npm_rows=$(python3 "$repo_root/tools/ci/check-audited-workspaces.py" \
  --manifest "$workspaces_manifest" --repo-root "$repo_root" --print --ecosystem npm)

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
while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
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
while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
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
while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
  ghsa_args+=(--lockfile "$repo_root/$ws_lockfile")
done <<<"$workspace_rows"
python3 "$repo_root/tools/ci/check-ghsa-only.py" \
  --scanner "$osv" \
  --waivers "${BLEAVIT_GHSA_WAIVERS:-$repo_root/tools/ci/ghsa-waivers.toml}" \
  "${ghsa_args[@]}"

# Leg 4 — npm advisories (14 §3.6 TH-44).
#
# TH-44 lists "`npm audit`/OSV CI" among its mitigations and nothing implemented
# it. `app/pnpm-lock.yaml` backs the bundle a browser executes and was outside
# every supply-chain gate here (SQ-985). The same pinned osv-scanner serves it:
# the scanner picks its ecosystem from the lockfile's own name, so one digest-
# pinned binary covers both. `pnpm audit` is deliberately NOT used — it ships
# whatever pnpm ships rather than a pinned digest, its findings come from npm's
# own GHSA mirror which OSV already aggregates, and its ignore mechanism
# (`pnpm.auditConfig.ignoreCves`) cannot expire the way a waiver file does.
#
# The verdict rule is stricter than leg 3's and has its own checker for that
# reason: leg 3 skips what cargo-audit gates, and nothing gates what this leg
# would skip. See tools/ci/check-npm-advisories.py.
npm_args=()
while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
  [[ -n "$ws_lockfile" ]] || continue
  assert_lockfile "$ws_lockfile"
  npm_args+=(--lockfile "$repo_root/$ws_lockfile")
done <<<"$npm_rows"
if [[ ${#npm_args[@]} -eq 0 ]]; then
  # An empty npm work list is a manifest defect, not a clean tree: this
  # repository commits `app/pnpm-lock.yaml`, and a run that scanned no npm
  # lockfile at all would print nothing and pass. Fail instead.
  echo "no npm lockfile rows in $workspaces_manifest; refusing to report a clean npm leg" >&2
  exit 1
fi
python3 "$repo_root/tools/ci/check-npm-advisories.py" \
  --scanner "$osv" \
  --waivers "${BLEAVIT_NPM_WAIVERS:-$repo_root/tools/ci/npm-advisory-waivers.toml}" \
  "${npm_args[@]}"

# Leg 5 — the `unsound` advisories leg 2 prints and passes.
#
# cargo-audit fails on a RustSec *vulnerability* and merely warns on an
# *informational* advisory. The GitHub Advisory Database does not draw that line:
# it grades RUSTSEC-2024-0429 (`glib`, unsound `VariantStrIter`) as a MEDIUM
# vulnerability, and Dependabot reported it against `app/Cargo.lock` while this
# whole script was green — and would have stayed green, because leg 2 allowed it
# and leg 3 skips anything RustSec carries, by contract. Neither leg was
# misconfigured. Between them sat a class of finding nothing failed on.
#
# This leg gates exactly that disputed class. `unmaintained` stays an allowed
# warning, as `.cargo/audit.toml` has always said; see the checker for where the
# line is drawn and why.
#
# THIS LEG RUNS UNSUPPRESSED, AND THAT IS THE WHOLE DESIGN.
#
# `cargo-audit` reads `.cargo/audit.toml` from its working directory, so every
# run above inherits that workspace's `ignore` list — and an ignored advisory is
# removed from `warnings` ENTIRELY, not merely marked. Measured, not assumed:
# ignoring RUSTSEC-2024-0429 takes `app`'s report from 16 unmaintained + 1
# unsound to 16 unmaintained + 0.
#
# So a leg 5 reading leg 2's reports would be defeated by one line in the very
# file it exists to be independent of. The waiver file would show no entry, the
# stale-waiver leg would see nothing to be stale about, and CI would go green
# over an untriaged `unsound` advisory. That bypass is not hypothetical: before
# this leg existed an unsound advisory was silent anyway, and now that one turns
# CI red, adding its id to `.cargo/audit.toml` is the first thing a person under
# time pressure would reach for.
#
# The reports below are therefore produced from a directory that holds NO
# `.cargo/audit.toml`, with `--file` naming each lockfile. That yields the true
# advisory set per lockfile, whatever any workspace chose to suppress. The
# checker re-proves it by refusing any report whose `settings.ignore` is
# non-empty, so a stray config cannot quietly re-suppress this leg.
#
# Clause 4 isolation is untouched: leg 2 still audits each workspace from its own
# root, and the summary below still reports each workspace's own ignore list from
# its own with-config run. Those runs answer "what did this workspace accept";
# this one answers "what is actually in the lockfile", and only the second
# question is leg 5's.
#
# `cargo audit` exits non-zero when a lockfile carries vulnerabilities, and
# unsuppressed the root workspace carries the ones `.cargo/audit.toml` waives for
# leg 2. That exit is expected here and says nothing about this leg, whose only
# input is `warnings`. The shell therefore tolerates the status and the checker
# fails closed on a report it cannot read — a scan that did not happen is not a
# clean scan, and that judgement belongs in the checker rather than in `$?`.
unsuppressed_reports=$(mktemp -d)
trap 'rm -rf "$unsuppressed_reports"' EXIT
unsound_args=()
while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
  (
    cd "$unsuppressed_reports"
    "$auditor" audit --json --no-fetch --file "$repo_root/$ws_lockfile" \
      >"$unsuppressed_reports/$ws_name.json" || true
  )
  unsound_args+=(--report "$ws_name=$unsuppressed_reports/$ws_name.json")
done <<<"$workspace_rows"
python3 "$repo_root/tools/ci/check-unsound-advisories.py" \
  --waivers "${BLEAVIT_UNSOUND_WAIVERS:-$repo_root/tools/ci/unsound-waivers.toml}" \
  "${unsound_args[@]}"

if [[ -n "$summary_out" ]]; then
  # The summary needs each workspace's OWN ignore list to re-prove clause 4
  # isolation on every run, so it takes with-config runs from each workspace
  # root. The unsuppressed reports above report `ignore: []` for every workspace
  # by construction and would turn that disclosure into a uniform blank.
  summary_reports=$(mktemp -d)
  trap 'rm -rf "$unsuppressed_reports" "$summary_reports"' EXIT
  summary_args=()
  while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
    (
      cd "$repo_root/$ws_dir"
      "$auditor" audit --json --no-fetch >"$summary_reports/$ws_name.json"
    )
    summary_args+=("$ws_name=$summary_reports/$ws_name.json")
  done <<<"$workspace_rows"
  npm_lockfiles=""
  while IFS=$'\t' read -r ws_name ws_eco ws_dir ws_lockfile; do
    [[ -n "$ws_lockfile" ]] || continue
    npm_lockfiles+="$ws_lockfile"$'\n'
  done <<<"$npm_rows"
  python3 - "$summary_out" \
    "${BLEAVIT_GHSA_WAIVERS:-$repo_root/tools/ci/ghsa-waivers.toml}" \
    "$repo_root/tools/ci/check-ghsa-only.py" \
    "${BLEAVIT_NPM_WAIVERS:-$repo_root/tools/ci/npm-advisory-waivers.toml}" \
    "$repo_root/tools/ci/check-npm-advisories.py" \
    "${BLEAVIT_UNSOUND_WAIVERS:-$repo_root/tools/ci/unsound-waivers.toml}" \
    "$repo_root/tools/ci/check-unsound-advisories.py" \
    "$npm_lockfiles" \
    "${summary_args[@]}" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path

output = Path(sys.argv[1])
ghsa_waivers = Path(sys.argv[2])
checker_path = Path(sys.argv[3])
npm_waivers = Path(sys.argv[4])
npm_checker_path = Path(sys.argv[5])
unsound_waivers = Path(sys.argv[6])
unsound_checker_path = Path(sys.argv[7])
npm_lockfiles = sorted(line for line in sys.argv[8].splitlines() if line.strip())
reports = [argument.split("=", 1) for argument in sys.argv[9:]]


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

def load_checker(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = load_checker("check_ghsa_only", checker_path)
waived_ghsa_only = [
    {"id": identifier, "package": package, "version": version}
    for identifier, package, version in sorted(checker.load_waivers(ghsa_waivers))
]

# v4 extends the same disclosure property to the npm leg. v3's own comment records
# why: extending the gate without extending the summary turns a full disclosure
# into a partial one silently. An npm waiver is accepted risk in the bundle's own
# dependency graph, so a release that publishes only the cargo waivers understates
# exactly the risk 14 §3.6 TH-44 is about. `reaches_bundle` travels with the entry
# because it is the fact a reader of the manifest needs and cannot recover.
npm_checker = load_checker("check_npm_advisories", npm_checker_path)
waived_npm = [
    {
        "id": row["id"],
        "package": row["package"],
        "version": row["version"],
        "reaches_bundle": row["reaches_bundle"],
    }
    for _key, row in sorted(npm_checker.load_waivers(npm_waivers).items())
]

# v5 extends the same disclosure property to the unsound leg, for the third time
# and for the reason v3 and v4 each recorded: extending the gate without
# extending the summary turns a full disclosure into a partial one silently. An
# unsound waiver is accepted undefined behavior in a shipped artifact's graph, so
# a release that publishes the cargo and npm waivers and stays quiet about this
# one understates precisely the risk R-7 is strictest about. `exposure` travels
# with the entry because it is the fact a reader needs and cannot recover from
# the id — and because "the affected function is called" (`constrained`) is a
# materially different disclosure from "it is not" (`unreachable`).
unsound_checker = load_checker("check_unsound_advisories", unsound_checker_path)
waived_unsound = [
    {
        "id": row["id"],
        "package": row["package"],
        "version": row["version"],
        "workspace": row["workspace"],
        "exposure": row["exposure"],
    }
    for _key, row in sorted(unsound_checker.load_waivers(unsound_waivers).items())
]

summary = {
    "schema": "bleavit.supply-chain.v5",
    "ignored_advisory_ids": sorted(union),
    "waived_ghsa_only": waived_ghsa_only,
    "waived_npm": waived_npm,
    "waived_unsound": waived_unsound,
    "npm_lockfiles": npm_lockfiles,
    "workspaces": workspaces,
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
fi
