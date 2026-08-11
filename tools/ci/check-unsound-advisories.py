#!/usr/bin/env python3
"""Fail on any `unsound` RustSec advisory that no one has triaged.

WHY THIS LEG EXISTS

`cargo-audit` sorts a RustSec advisory into one of two piles. A *vulnerability*
fails the run. An *informational* advisory — `unmaintained`, `unsound`, `notice`,
`yanked` — prints and passes, and the run ends with a line like
`warning: 17 allowed warnings found`.

The GitHub Advisory Database does not use that split. It grades
RUSTSEC-2024-0429 (`glib` 0.18.5, unsound `VariantStrIter`) as a **medium
severity vulnerability**, and Dependabot reported it against `app/Cargo.lock`
while every gate in this repository was green — and would have stayed green
forever. Leg 2 saw the advisory and allowed it. Leg 3 skipped it by contract:
`check-ghsa-only.py` gates the complement of cargo-audit's reach, so anything
carrying a RUSTSEC id is deliberately not its business. Neither leg was
misconfigured. Between them was a class of finding nothing failed on.

So the line this leg draws is exactly the disputed one: **the informational
kinds GHSA may grade as vulnerabilities**. Empirically that is `unsound` and
nothing else. `unmaintained` says a crate has no maintainer, which names no
defect and no mechanism; GHSA does not raise advisories for it, and the ~30 such
warnings here would drown a waiver file in entries no one could act on.
`unsound` names a specific defect by which safe code reaches undefined
behavior. Under R-7 that is not a warning in a collator or a signed desktop
binary. `GATED_WARNING_KINDS` is one edit wide if that judgement changes.

THE RULE

Every `unsound` warning must be fixed, or waived in
`tools/ci/unsound-waivers.toml` with a stated blocking pin and a condition that
clears it. A waiver matching no finding also fails (stale-waiver leg): an
exemption can never outlive the advisory that justified it — the limit-coverage
registry discipline (SQ-155) applied to supply chain.

THE REPORTS MUST BE UNSUPPRESSED, AND THIS CHECKER REFUSES ANY THAT ARE NOT

`cargo-audit` reads `.cargo/audit.toml` from its working directory, and an
ignored advisory is dropped from `warnings` **entirely** rather than marked.
Measured: ignoring RUSTSEC-2024-0429 takes `app`'s report from 16 unmaintained +
1 unsound to 16 unmaintained + 0.

So a gate reading the same reports leg 2 reads would be defeated by one line in
the very file it exists to be independent of — no finding to be unwaived, no
waiver to go stale, and a green run over an untriaged advisory. The stale-waiver
leg does NOT cover this: it only fires when something already waived here is
suppressed, and the dangerous case is an advisory that was never waived at all.
Nor is the bypass hypothetical. Before this leg an `unsound` advisory was silent
anyway; now that one turns CI red, adding its id to `.cargo/audit.toml` is the
first thing a person under time pressure would reach for.

`tools/ci/supply-chain-gates.sh` therefore produces this leg's reports from a
directory holding no `.cargo/audit.toml`, naming each lockfile with `--file`.
This checker re-proves that rather than trusting it: a report whose
`settings.ignore` is non-empty is REFUSED, so a stray config cannot quietly
re-suppress the one leg whose job is to not be suppressible.

WAIVERS ARE PER WORKSPACE

Doc 15 §4.5 clause 4 (blast-radius containment) requires each workspace to be
audited from its own root so that one workspace's exception cannot excuse
another's. The same argument applies to the triage: `event-listener` appeared in
both the root workspace and `keeper/`, and "unreachable" is a claim about a
particular dependency graph, not about a crate name. The key therefore carries
the workspace, and a crate shared by two workspaces needs two entries — each
making its own argument, or each citing the other's.

`exposure` IS REQUIRED, AND `"triggerable"` CANNOT BE WAIVED

The npm leg refuses `reaches_bundle = "yes"` because a hostile package in the
bundle IS the threat 14 §3.6 TH-44 describes. The parallel here is undefined
behavior a shipped artifact can actually reach, which R-7 says gets patched or
routed around rather than excused.

But the field is deliberately NOT a yes/no, because the first real triage broke
that shape. `memmap2`'s advisory names six affected functions, and `parity-db`
calls one of them — so "is it reachable" answered `yes` and would have made the
gate unwaivable and red, while the honest finding is that the single call site
passes a range derived from the mapping's own length and cannot go out of
bounds. A binary field would have forced either a false `"no"` or a broken gate.
Three states, and the middle one carries its evidence:

  unreachable  — nothing this repository builds calls the affected function.
  constrained  — it is called, and every call site provably cannot meet the
                 defect's precondition. `call_sites` is then REQUIRED, so the
                 claim names the code a reviewer must re-read when the pin moves.
  triggerable  — refused at load time.

As on the npm leg, the claim is asserted by the triager and reviewed. What is
machine-checked is that `"triggerable"` can never buy an exemption, and that a
`"constrained"` argument can never be made without citing where.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 compatibility for the local quality gate.
    tomllib = None  # type: ignore[assignment]


# The informational kinds this leg gates. See the module docstring: the line is
# "what GHSA may grade as a vulnerability", not "everything cargo-audit prints".
GATED_WARNING_KINDS = ("unsound",)

REQUIRED_WAIVER_KEYS = {
    "id",
    "package",
    "version",
    "workspace",
    "exposure",
    "reason",
    "blocked_by",
    "clears_when",
    "triaged",
}
EXPOSURES = ("unreachable", "constrained", "triggerable")


def strip_comment(raw: str) -> str:
    """Drop a trailing `#` comment without cutting a `#` inside a quoted value.

    Mirrors `tools/ci/check-ghsa-only.py`, `tools/ci/check-npm-advisories.py` and
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
    and string arrays, and refuses anything else rather than guessing.
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
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)", line)
        if not match or current is None:
            raise SystemExit(
                f"unsound-waivers.toml: unsupported line for the 3.10 compat parser: {raw!r}"
            )
        key, value = match.group(1), match.group(2).strip()
        if value.startswith("["):
            current[key] = re.findall(r'"([^"]*)"', value)
        elif value.startswith('"') and value.endswith('"') and len(value) >= 2:
            current[key] = value[1:-1].replace('\\"', '"')
        else:
            raise SystemExit(
                f"unsound-waivers.toml: unsupported value for the 3.10 compat parser: {raw!r}"
            )
    return waivers


def waiver_key(
    identifier: str, package: str, version: str, workspace: str
) -> tuple[str, str, str, str]:
    """Waivers bind to (advisory, package, version, workspace).

    The version is the triage's subject: a containment argument is made about the
    resolved version in a lockfile, not about a package name, so a bump makes the
    waiver stale and demands a fresh triage. The workspace is there for the
    reason 15 §4.5 clause 4 gives — an argument about one dependency graph says
    nothing about another's, and this repository has four.
    """
    return (identifier, package, version, workspace)


def load_waivers(path: Path) -> dict[tuple[str, str, str, str], dict]:
    if tomllib is None:
        rows = parse_waivers_toml_compat(path.read_text(encoding="utf-8"))
    else:
        with path.open("rb") as handle:
            rows = tomllib.load(handle).get("waiver", [])
    waivers: dict[tuple[str, str, str, str], dict] = {}
    for row in rows:
        missing = REQUIRED_WAIVER_KEYS - set(row)
        if missing:
            raise SystemExit(
                f"unsound-waivers.toml: waiver {row.get('id', '?')} is missing {sorted(missing)}"
            )
        exposure = row["exposure"]
        if exposure not in EXPOSURES:
            raise SystemExit(
                f"unsound-waivers.toml: waiver {row['id']} declares exposure = "
                f"{exposure!r}; it must be one of {list(EXPOSURES)}"
            )
        # R-7: undefined behavior a shipped artifact can reach gets patched or
        # routed around, never excused. Refusing this at load time rather than at
        # match time means the file cannot even hold such an entry.
        if exposure == "triggerable":
            raise SystemExit(
                f"unsound-waivers.toml: waiver {row['id']} ({row['package']} "
                f"{row['version']}, {row['workspace']}) declares exposure = "
                '"triggerable". Undefined behavior a shipped artifact can reach is not '
                "waivable (R-7). Patch the dependency, or remove the reaching call from "
                "the graph."
            )
        # A "constrained" waiver is the only one that concedes the affected code
        # runs. Its whole weight rests on what the call sites pass, so the entry
        # has to name them — otherwise the next reader cannot re-check the claim
        # when the pin moves, and the strongest-sounding exposure would be the
        # one carrying the least evidence.
        if exposure == "constrained":
            sites = row.get("call_sites")
            if not isinstance(sites, list) or not sites or any(not s.strip() for s in sites):
                raise SystemExit(
                    f"unsound-waivers.toml: waiver {row['id']} ({row['package']} "
                    f"{row['version']}, {row['workspace']}) declares exposure = "
                    '"constrained" but names no call_sites. An argument that every call '
                    "site is safe must say which call sites it inspected."
                )
        key = waiver_key(row["id"], row["package"], row["version"], row["workspace"])
        if key in waivers:
            raise SystemExit(f"unsound-waivers.toml: duplicate waiver for {key}")
        waivers[key] = row
    return waivers


def load_report(path: Path, workspace: str) -> dict:
    """Read one report, refusing anything that is not one.

    The gate tolerates cargo-audit's exit status for this leg, because an
    unsuppressed run legitimately exits non-zero on the vulnerabilities leg 2
    waives. That makes "the run produced a usable report" this checker's
    question rather than the shell's, and an empty or truncated file is the shape
    a failed run leaves behind — so it must read as a failure here, not as a
    traceback and not as a clean scan.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise SystemExit(f"cannot read cargo-audit report for {workspace}: {path} ({error})")
    if not raw.strip():
        raise SystemExit(
            f"cargo-audit report for {workspace} is empty: {path}. The run that should have "
            "produced it failed; a scan that did not happen is not a clean scan."
        )
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(
            f"cargo-audit report for {workspace} is not valid JSON: {path} ({error})"
        )
    if not isinstance(value, dict):
        raise SystemExit(f"cargo-audit report is not an object: {path} ({workspace})")
    return value


def gated_findings(report: dict, workspace: str, path: Path) -> list[dict]:
    """Every warning of a gated kind, flattened.

    `warnings` is `{kind: [row, ...]}`. A kind that is absent means the run found
    none of it, which is the ordinary case and not an error — but a `warnings`
    field that is not an object at all means the report is not what this checker
    thinks it is, and guessing there would report a clean scan that never
    happened.
    """
    # The suppression check comes first, because a suppressed report's `warnings`
    # object is well-formed and simply short — it looks exactly like a clean one.
    settings = report.get("settings")
    if not isinstance(settings, dict) or not isinstance(settings.get("ignore"), list):
        raise SystemExit(
            f"cargo-audit report has no `settings.ignore` array: {path} ({workspace}). "
            "This leg must prove its input was unsuppressed and cannot from this report."
        )
    if settings["ignore"]:
        raise SystemExit(
            f"cargo-audit report for {workspace} was produced with an active ignore list "
            f"({', '.join(settings['ignore'])}): {path}. An ignored advisory is dropped from "
            "`warnings` entirely, so this leg would report a clean scan it never performed. "
            "Produce this leg's reports from a directory with no .cargo/audit.toml, using "
            "`--file <lockfile>`; the per-workspace exception file governs leg 2, not this one."
        )
    warnings = report.get("warnings")
    if not isinstance(warnings, dict):
        raise SystemExit(
            f"cargo-audit report has no `warnings` object: {path} ({workspace}). "
            "Refusing to report a clean unsound leg from a report this checker cannot read."
        )
    out: list[dict] = []
    for kind in GATED_WARNING_KINDS:
        rows = warnings.get(kind) or []
        if not isinstance(rows, list):
            raise SystemExit(
                f"cargo-audit warnings.{kind} is not an array: {path} ({workspace})"
            )
        for row in rows:
            advisory = row.get("advisory") or {}
            package = row.get("package") or {}
            out.append(
                {
                    "kind": kind,
                    "id": advisory.get("id", ""),
                    "title": (advisory.get("title") or "").strip(),
                    "package": package.get("name", ""),
                    "version": package.get("version", ""),
                    "workspace": workspace,
                    "patched": (row.get("versions") or {}).get("patched") or [],
                }
            )
    return out


def parse_report_argument(raw: str) -> tuple[str, Path]:
    if "=" not in raw:
        raise SystemExit(f"--report expects <workspace>=<path>, got {raw!r}")
    workspace, path = raw.split("=", 1)
    if not workspace or not path:
        raise SystemExit(f"--report expects <workspace>=<path>, got {raw!r}")
    return workspace, Path(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--waivers", required=True, type=Path)
    parser.add_argument(
        "--report",
        action="append",
        required=True,
        metavar="WORKSPACE=PATH",
        help="a `cargo audit --json` report and the workspace it was produced in",
    )
    args = parser.parse_args()

    waivers = load_waivers(args.waivers)

    findings: list[dict] = []
    for raw in args.report:
        workspace, path = parse_report_argument(raw)
        findings.extend(gated_findings(load_report(path, workspace), workspace, path))

    def key_of(finding: dict) -> tuple[str, str, str, str]:
        return waiver_key(
            finding["id"], finding["package"], finding["version"], finding["workspace"]
        )

    matched = {key_of(f) for f in findings}
    unwaived = [f for f in findings if key_of(f) not in waivers]
    stale = sorted(set(waivers) - matched)

    kinds = "/".join(GATED_WARNING_KINDS)
    print(f"{kinds} advisories across {len(args.report)} workspace(s): {len(findings)}")
    for finding in sorted(findings, key=lambda f: (f["workspace"], f["package"], f["id"])):
        key = key_of(finding)
        state = "UNWAIVED" if key not in waivers else "waived"
        print(
            f"  [{state}] {finding['workspace']}: {finding['package']} "
            f"{finding['version']} — {finding['id']}"
        )
        if key in waivers:
            print(f"             exposure: {waivers[key]['exposure']}")
            print(f"             blocked_by: {waivers[key]['blocked_by']}")
            print(f"             clears_when: {waivers[key]['clears_when']}")

    # stdout is block-buffered when the gate's output is piped to a file, so the
    # failure text below would otherwise land above the listing it refers to and
    # a CI log would read back-to-front.
    sys.stdout.flush()

    # Report both classes before returning: a run that fixed one and introduced
    # the other should show both, not hide the second behind another red run.
    if unwaived:
        print(
            f"\nFAIL: {kinds} advisories with no waiver. RustSec calls these informational\n"
            "and cargo-audit passes on them; the GitHub Advisory Database grades them as\n"
            "vulnerabilities, and R-7 treats undefined behavior in a collator or a signed\n"
            "binary as neither. Update the dependency, or record the triage in\n"
            "tools/ci/unsound-waivers.toml with the pin that forces it, the condition that\n"
            "clears it, and what the affected code is actually exposed to.",
            file=sys.stderr,
        )
        for finding in unwaived:
            print(
                f"  {finding['workspace']}: {finding['package']} {finding['version']} — "
                f"{finding['id']} (patched {finding['patched']}): {finding['title']}",
                file=sys.stderr,
            )

    if stale:
        print(
            "\nFAIL: waivers that match no current finding. Whatever they excuse is gone\n"
            "or moved — the dependency changed version, the advisory was withdrawn, or an\n"
            "`ignore` entry in that workspace's .cargo/audit.toml is now suppressing it.\n"
            "Delete the entry, or re-triage it against what is there now, so the exemption\n"
            "cannot outlive its justification.",
            file=sys.stderr,
        )
        for key in stale:
            print(f"  {key[0]} ({key[1]} {key[2]}, {key[3]})", file=sys.stderr)

    if unwaived or stale:
        return 1

    print(f"\nOK: every {kinds} advisory is triaged and every waiver still applies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
