#!/usr/bin/env python3
"""Fail on any advisory in a committed npm lockfile — 14 §3.6 TH-44's missing control.

TH-44 (*Frontend supply-chain compromise*) lists among its mitigations "pinned
lockfile + integrity hashes; minimal deps; `npm audit`/OSV CI". The lockfile and
the integrity hashes existed. The CI leg did not, in any form, until 2026-08-07:
no `pnpm audit`, no `npm audit`, and an osv-scanner leg aimed only at cargo. So
`app/pnpm-lock.yaml` — which backs the bundle every user loads in a browser — was
outside every supply-chain gate this repository runs (SQ-985).

WHY THIS IS NOT `check-ghsa-only.py` WITH ONE MORE `--lockfile`

That checker's contract is "the complement of cargo-audit's reach", and it
implements it by SKIPPING every finding that carries a RUSTSEC id, on the stated
ground that cargo-audit gates those. Aimed at a pnpm lockfile the skip would
never fire, because RustSec covers crates.io and nothing else — so the checker
would appear to work while its documented reason for working was false, and the
first npm package to acquire a RustSec-aliased record would be handed to a
cargo-audit run that never scans this lockfile. A gate that is correct by
accident of its input is the shape of defect SQ-985 is about.

THE RULE HERE IS THEREFORE THE STRICT ONE. Nothing is skipped. Every finding must
be fixed, or waived in `tools/ci/npm-advisory-waivers.toml` with a stated blocking
pin and a condition that clears it. A waiver that matches no finding also fails
(stale-waiver leg): an exemption can never outlive the advisory that justified it
— the limit-coverage registry discipline (SQ-155) applied to supply chain.

`reaches_bundle` IS REQUIRED, AND `"yes"` CANNOT BE WAIVED

One pnpm workspace holds all 50 projects, so a single lockfile carries both the
client packages a browser executes and the tooling that builds and measures them.
The lockfile cannot tell those apart, and the entire triage turns on which one a
finding is: TH-44's impact column is "hostile code in the bundle", which a build
tool cannot produce. So every waiver states it, and a waiver claiming the package
reaches the bundle is REFUSED rather than accepted — a shipped advisory gets
patched, never excused. That is this file's answer to SQ-985's third question.

The claim itself is asserted by the triager and reviewed, not machine-checked;
what is machine-checked is that a `"yes"` can never buy an exemption.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 compatibility for the local quality gate.
    tomllib = None  # type: ignore[assignment]


def _load_sibling(name: str):
    """Import a sibling module by explicit path.

    This file is executed as a script by the gate and loaded by path from the
    test suites, so `tools/ci` is not reliably on `sys.path`. Resolving from
    `__file__` works under both.
    """
    spec = importlib.util.spec_from_file_location(
        f"bleavit_{name}", Path(__file__).resolve().parent / f"{name}.py"
    )
    if spec is None or spec.loader is None:
        raise OSError(f"cannot load sibling module {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The fail-closed driver is shared with the cargo leg, so "a scan that did not
# happen is not a clean scan" is written down once. The verdicts differ; the way
# the scanner is run does not.
osv_scan = _load_sibling("osv_scan")
SCAN_OK = osv_scan.SCAN_OK
scan = osv_scan.scan


REQUIRED_WAIVER_KEYS = {
    "id",
    "package",
    "version",
    "reaches_bundle",
    "reason",
    "blocked_by",
    "clears_when",
    "triaged",
}
BUNDLE_REACHABILITY = ("yes", "no")


def strip_comment(raw: str) -> str:
    """Drop a trailing `#` comment without cutting a `#` inside a quoted value.

    Mirrors `tools/ci/check-ghsa-only.py` and
    `tools/ci/check-audited-workspaces.py`. The CI path uses tomllib, so a naive
    split here would make the two parsers disagree silently, which is the worst
    way for a security gate's waiver file to be read.
    """
    out: list[str] = []
    in_string = False
    escaped = False
    for char in raw:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "#":
            break
        out.append(char)
    return "".join(out)


def parse_waivers_toml_compat(text: str) -> list[dict]:
    """Parse the `[[waiver]]` subset of TOML this file uses.

    Deliberately dependency-free and deliberately narrow, matching the sibling
    checkers: CI runs Python 3.12 and takes the tomllib path, so this only backs
    the local gate on 3.10. It understands `[[waiver]]` tables of basic strings
    and one string array, and refuses anything else rather than guessing.
    """
    waivers: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        line = strip_comment(raw).strip()
        if not line:
            continue
        if line == "[[waiver]]":
            current = {}
            waivers.append(current)
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)', line)
        if not match or current is None:
            raise SystemExit(
                f"npm-advisory-waivers.toml: unsupported line for the 3.10 compat parser: {raw!r}"
            )
        key, value = match.group(1), match.group(2).strip()
        if value.startswith("["):
            current[key] = re.findall(r'"([^"]*)"', value)
        elif value.startswith('"') and value.endswith('"') and len(value) >= 2:
            current[key] = value[1:-1].replace('\\"', '"')
        else:
            raise SystemExit(
                f"npm-advisory-waivers.toml: unsupported value for the 3.10 compat parser: {raw!r}"
            )
    return waivers


def waiver_key(identifier: str, package: str, version: str) -> tuple[str, str, str]:
    """Waivers bind to (advisory, package, version), never to the advisory alone.

    The version is the triage's subject: a containment argument is made about the
    resolved version in the lockfile, not about a package name. Keying on the id
    alone would let that reasoning silently cover a later version, or the same
    advisory reached through a different package. Instead a version bump makes
    the waiver stale and the gate demands a fresh triage.
    """
    return (identifier, package, version)


def load_waivers(path: Path) -> dict[tuple[str, str, str], dict]:
    if tomllib is None:
        rows = parse_waivers_toml_compat(path.read_text(encoding="utf-8"))
    else:
        with path.open("rb") as handle:
            rows = tomllib.load(handle).get("waiver", [])
    waivers: dict[tuple[str, str, str], dict] = {}
    for row in rows:
        missing = REQUIRED_WAIVER_KEYS - set(row)
        if missing:
            raise SystemExit(
                f"npm-advisory-waivers.toml: waiver {row.get('id', '?')} is missing {sorted(missing)}"
            )
        reaches = row["reaches_bundle"]
        if reaches not in BUNDLE_REACHABILITY:
            raise SystemExit(
                f"npm-advisory-waivers.toml: waiver {row['id']} declares "
                f"reaches_bundle = {reaches!r}; it must be one of {list(BUNDLE_REACHABILITY)}"
            )
        # TH-44's impact is "hostile code in the bundle". A package that reaches
        # the bundle is exactly that threat, so it is not waivable at all — the
        # dependency gets patched. Refusing this at load time rather than at
        # match time means the file cannot even hold such an entry.
        if reaches == "yes":
            raise SystemExit(
                f"npm-advisory-waivers.toml: waiver {row['id']} ({row['package']} "
                f"{row['version']}) declares reaches_bundle = \"yes\". An advisory in a "
                "package the browser bundle carries is 14 §3.6 TH-44 itself and cannot be "
                "waived. Patch the dependency, or remove it from the shipped graph."
            )
        key = waiver_key(row["id"], row["package"], row["version"])
        if key in waivers:
            raise SystemExit(f"npm-advisory-waivers.toml: duplicate waiver for {key}")
        waivers[key] = row
    return waivers


def npm_findings(report: dict, lockfile: Path) -> list[dict]:
    """Every vulnerability in the report. Nothing is skipped, by contract.

    The ecosystem is asserted rather than assumed. Handing this checker a cargo
    lockfile would otherwise demand npm-shaped waivers for advisories cargo-audit
    already gates, and the reverse mistake — a pnpm lockfile wired into the
    GHSA-only leg — is the silent one. Failing loudly here is what makes the
    routing in `tools/ci/supply-chain-gates.sh` checkable rather than trusted.
    """
    out = []
    for result in report.get("results", []):
        for pkg in result.get("packages", []):
            package = pkg["package"]
            ecosystem = package.get("ecosystem")
            if ecosystem != "npm":
                sys.exit(
                    f"{lockfile} yielded a {ecosystem!r}-ecosystem package "
                    f"({package.get('name')}); this checker gates npm lockfiles only. "
                    "Check the ecosystem routing in tools/ci/audited-workspaces.toml."
                )
            for vuln in pkg.get("vulnerabilities", []):
                out.append(
                    {
                        "id": vuln.get("id", ""),
                        "aliases": sorted(vuln.get("aliases") or []),
                        "package": package["name"],
                        "version": package["version"],
                        "lockfile": str(lockfile),
                        "summary": (vuln.get("summary") or "").strip(),
                    }
                )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scanner", required=True, help="path to the pinned osv-scanner binary")
    parser.add_argument("--waivers", required=True, type=Path)
    parser.add_argument("--lockfile", action="append", required=True, type=Path)
    args = parser.parse_args()

    waivers = load_waivers(args.waivers)

    findings: list[dict] = []
    for lockfile in args.lockfile:
        findings.extend(npm_findings(scan(args.scanner, lockfile), lockfile))

    matched = {waiver_key(f["id"], f["package"], f["version"]) for f in findings}
    unwaived = [f for f in findings if waiver_key(f["id"], f["package"], f["version"]) not in waivers]
    stale = sorted(set(waivers) - matched)

    print(f"npm advisories in {len(args.lockfile)} lockfile(s): {len(findings)}")
    for finding in sorted(findings, key=lambda f: (f["package"], f["id"])):
        key = waiver_key(finding["id"], finding["package"], finding["version"])
        state = "UNWAIVED" if key not in waivers else "waived"
        print(f"  [{state}] {finding['package']} {finding['version']} — {finding['id']} {finding['aliases']}")
        if key in waivers:
            print(f"             reaches_bundle: {waivers[key]['reaches_bundle']}")
            print(f"             blocked_by: {waivers[key]['blocked_by']}")
            print(f"             clears_when: {waivers[key]['clears_when']}")

    # Report both classes before returning: a run that fixed one and introduced
    # the other should show both, not hide the second behind another red run.
    if unwaived:
        print(
            "\nFAIL: npm advisories with no waiver. This lockfile backs the bundle a\n"
            "browser executes (14 §3.6 TH-44), so update the dependency, or record the\n"
            "triage in tools/ci/npm-advisory-waivers.toml with the pin that forces it,\n"
            "the condition that clears it, and whether it reaches the bundle.",
            file=sys.stderr,
        )
        for finding in unwaived:
            print(
                f"  {finding['package']} {finding['version']} — {finding['id']} "
                f"{finding['aliases']}: {finding['summary']}",
                file=sys.stderr,
            )

    if stale:
        print(
            "\nFAIL: waivers that match no current finding. Whatever they excuse is gone\n"
            "or moved — the dependency changed version, the advisory was withdrawn or\n"
            "re-keyed. Delete the entry, or re-triage it against what is there now, so\n"
            "the exemption cannot outlive its justification.",
            file=sys.stderr,
        )
        for key in stale:
            print(f"  {key[0]} ({key[1]} {key[2]})", file=sys.stderr)

    if unwaived or stale:
        return 1

    print("\nOK: every npm advisory is triaged and every waiver still applies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
