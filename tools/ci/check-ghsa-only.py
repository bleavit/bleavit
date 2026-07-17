#!/usr/bin/env python3
"""Fail on GHSA-only advisories — the delta the 15 §4.5 RustSec gate cannot see.

`cargo-audit` gates against the RustSec advisory-db. For crates.io the GitHub
Advisory Database is a strict superset: an advisory can carry no RUSTSEC id at
all (yamux GHSA-vxx9-2994-q338 / CVE-2026-32314, a HIGH remote panic, is the
worked example), and cargo-audit is then structurally blind to it.

This checker consumes `osv-scanner` JSON — OSV aggregates both databases — and
enforces exactly the complement of cargo-audit's reach:

  * a finding whose id or aliases include a RUSTSEC id is cargo-audit's to
    gate (with `.cargo/audit.toml` for the pin-forced exceptions). Skipped
    here, so this gate never duplicates that list and never inherits the
    informational (`unmaintained`/`unsound`) warnings RustSec classifies and
    OSV does not.
  * a finding with no RUSTSEC id anywhere is GHSA-only. It MUST be waived in
    `tools/ci/ghsa-waivers.toml` with a stated blocking pin, or the gate fails.

A waiver that matches no finding also fails (stale-waiver leg): an exemption
can never outlive the advisory that justified it — the limit-coverage registry
discipline (SQ-155) applied to supply chain.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 compatibility for the local quality gate.
    tomllib = None  # type: ignore[assignment]


def parse_waivers_toml_compat(text: str) -> list[dict]:
    """Parse the `[[waiver]]` subset of TOML this file uses.

    Deliberately dependency-free and deliberately narrow, matching
    tools/limit-coverage/check-limit-coverage.py: CI runs Python 3.12 and takes
    the tomllib path above, so this only backs the local gate on 3.10. It
    understands exactly what ghsa-waivers.toml contains — `[[waiver]]` tables of
    basic strings and one string array — and refuses anything else rather than
    guessing.
    """
    waivers: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip() if not raw.strip().startswith("#") else ""
        if not line:
            continue
        if line == "[[waiver]]":
            current = {}
            waivers.append(current)
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)', line)
        if not match or current is None:
            raise SystemExit(f"ghsa-waivers.toml: unsupported line for the 3.10 compat parser: {raw!r}")
        key, value = match.group(1), match.group(2).strip()
        if value.startswith("["):
            items = re.findall(r'"([^"]*)"', value)
            current[key] = items
        elif value.startswith('"') and value.endswith('"') and len(value) >= 2:
            current[key] = value[1:-1].replace('\\"', '"')
        else:
            raise SystemExit(f"ghsa-waivers.toml: unsupported value for the 3.10 compat parser: {raw!r}")
    return waivers


def load_waivers(path: Path) -> dict[str, dict]:
    if tomllib is None:
        rows = parse_waivers_toml_compat(path.read_text(encoding="utf-8"))
    else:
        with path.open("rb") as fh:
            rows = tomllib.load(fh).get("waiver", [])
    required = {"id", "package", "version", "reason", "blocked_by", "clears_when"}
    for row in rows:
        missing = required - set(row)
        if missing:
            raise SystemExit(f"ghsa-waivers.toml: waiver {row.get('id', '?')} is missing {sorted(missing)}")
    return {row["id"]: row for row in rows}


def rustsec_covered(vuln: dict) -> bool:
    """True when RustSec carries this advisory, i.e. cargo-audit can see it."""
    ids = [vuln.get("id", "")] + list(vuln.get("aliases") or [])
    return any(i.startswith("RUSTSEC-") for i in ids)


def scan(scanner: str, lockfile: Path) -> dict:
    proc = subprocess.run(
        [scanner, "scan", "source", f"--lockfile={lockfile}", "--format=json"],
        capture_output=True,
        text=True,
    )
    # osv-scanner exits non-zero purely because it found vulnerabilities; that is
    # this checker's input, not its verdict. Only a missing/!JSON stdout is fatal.
    if not proc.stdout.strip():
        sys.exit(f"osv-scanner produced no output for {lockfile}:\n{proc.stderr}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        sys.exit(f"osv-scanner output for {lockfile} is not JSON ({exc}):\n{proc.stdout[:2000]}")


def ghsa_only_findings(report: dict, lockfile: Path) -> list[dict]:
    out = []
    for result in report.get("results", []):
        for pkg in result.get("packages", []):
            name = pkg["package"]["name"]
            version = pkg["package"]["version"]
            for vuln in pkg.get("vulnerabilities", []):
                if rustsec_covered(vuln):
                    continue
                out.append(
                    {
                        "id": vuln.get("id", ""),
                        "aliases": sorted(vuln.get("aliases") or []),
                        "package": name,
                        "version": version,
                        "lockfile": str(lockfile),
                        "summary": (vuln.get("summary") or "").strip(),
                    }
                )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scanner", required=True, help="path to the pinned osv-scanner binary")
    ap.add_argument("--waivers", required=True, type=Path)
    ap.add_argument("--lockfile", action="append", required=True, type=Path)
    args = ap.parse_args()

    waivers = load_waivers(args.waivers)

    findings: list[dict] = []
    for lockfile in args.lockfile:
        findings.extend(ghsa_only_findings(scan(args.scanner, lockfile), lockfile))

    unwaived = [f for f in findings if f["id"] not in waivers]
    matched = {f["id"] for f in findings}
    stale = sorted(set(waivers) - matched)

    print(f"GHSA-only findings (invisible to cargo-audit): {len(findings)}")
    for f in sorted(findings, key=lambda f: (f["package"], f["id"])):
        state = "UNWAIVED" if f["id"] in {u["id"] for u in unwaived} else "waived"
        print(f"  [{state}] {f['package']} {f['version']} — {f['id']} {f['aliases']}")
        if state == "waived":
            print(f"             blocked_by: {waivers[f['id']]['blocked_by']}")
            print(f"             clears_when: {waivers[f['id']]['clears_when']}")

    if unwaived:
        print(
            "\nFAIL: GHSA-only advisories with no waiver. cargo-audit cannot see these —\n"
            "triage each one and record it in tools/ci/ghsa-waivers.toml with the pin\n"
            "that forces it and the condition that clears it, or fix the dependency.",
            file=sys.stderr,
        )
        for f in unwaived:
            print(f"  {f['package']} {f['version']} — {f['id']} {f['aliases']}: {f['summary']}", file=sys.stderr)
        return 1

    if stale:
        print(
            "\nFAIL: waivers that match no current finding. The advisory they excuse is\n"
            "gone (dependency moved, or the advisory was withdrawn/re-keyed) — delete\n"
            "the entry so the exemption cannot outlive its justification.",
            file=sys.stderr,
        )
        for wid in stale:
            print(f"  {wid} ({waivers[wid]['package']} {waivers[wid]['version']})", file=sys.stderr)
        return 1

    print("\nOK: every GHSA-only advisory is triaged and every waiver still applies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
