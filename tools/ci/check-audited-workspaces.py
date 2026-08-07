#!/usr/bin/env python3
"""Fail when a committed cargo lockfile is not classified for the supply-chain gate.

`tools/ci/supply-chain-gates.sh` used to name its lockfiles inline. It audited
`Cargo.lock` and `keeper/Cargo.lock`, and nothing ever compared that pair against
the repository. `app/Cargo.lock` and `fuzz/Cargo.lock` were added later and were
never audited: 17 and 5 advisory findings respectively, behind a green job, for as
long as those workspaces existed. A gate that never looks reports silence rather
than absence.

This checker removes the class of defect rather than the instance. It reads
`tools/ci/audited-workspaces.toml`, lists every committed cargo lockfile with
`git ls-files`, and fails on any difference in either direction:

  * a committed lockfile with no row — the fifth lockfile nobody wired up;
  * a row naming a lockfile git does not track — a stale row whose workspace was
    deleted or renamed, which would otherwise fail later and less clearly.

`--print` emits one `name<TAB>directory<TAB>lockfile` row per workspace on stdout
after the same check passes, so the gate script derives its work list from the
manifest instead of restating it. The check always runs, so `--print` can never
hand the gate a list it has not just verified.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 compatibility for the local quality gate.
    tomllib = None  # type: ignore[assignment]


REQUIRED_KEYS = {"name", "directory", "lockfile", "audit_config", "ships"}


def strip_comment(raw: str) -> str:
    """Drop a trailing `#` comment without cutting a `#` inside a quoted value.

    Mirrors `tools/ci/check-ghsa-only.py`. The CI path uses tomllib, so a naive
    split here would make the two parsers disagree silently, which is the worst
    way for a security gate's manifest to be read.
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


def parse_workspaces_toml_compat(text: str) -> list[dict]:
    """Parse the `[[workspace]]` subset of TOML this manifest uses.

    Deliberately dependency-free and deliberately narrow, matching
    `tools/ci/check-ghsa-only.py` and `tools/limit-coverage/check-limit-coverage.py`:
    CI runs Python 3.12 and takes the tomllib path, so this only backs the local
    gate on 3.10. It understands `[[workspace]]` tables of basic strings and
    refuses anything else rather than guessing.
    """
    rows: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        line = strip_comment(raw).strip()
        if not line:
            continue
        if line == "[[workspace]]":
            current = {}
            rows.append(current)
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)', line)
        if not match or current is None:
            raise SystemExit(
                f"audited-workspaces.toml: unsupported line for the 3.10 compat parser: {raw!r}"
            )
        key, value = match.group(1), match.group(2).strip()
        if value.startswith('"') and value.endswith('"') and len(value) >= 2:
            current[key] = value[1:-1].replace('\\"', '"')
        else:
            raise SystemExit(
                f"audited-workspaces.toml: unsupported value for the 3.10 compat parser: {raw!r}"
            )
    return rows


def load_workspaces(path: Path) -> list[dict]:
    """Load and structurally validate the manifest.

    Every failure here is a manifest defect rather than a repository state, so it
    raises instead of returning a report: the gate must not run a partially
    understood work list.
    """
    if tomllib is None:
        rows = parse_workspaces_toml_compat(path.read_text(encoding="utf-8"))
    else:
        with path.open("rb") as handle:
            rows = tomllib.load(handle).get("workspace", [])
    if not rows:
        raise SystemExit(f"{path}: declares no workspaces")

    seen_names: set[str] = set()
    seen_lockfiles: set[str] = set()
    for row in rows:
        missing = REQUIRED_KEYS - set(row)
        if missing:
            raise SystemExit(
                f"{path}: workspace {row.get('name', '?')} is missing {sorted(missing)}"
            )
        unknown = set(row) - REQUIRED_KEYS
        if unknown:
            raise SystemExit(
                f"{path}: workspace {row['name']} has unknown keys {sorted(unknown)}"
            )
        name, directory, lockfile = row["name"], row["directory"], row["lockfile"]
        if not name or not directory or not lockfile:
            raise SystemExit(f"{path}: workspace {name!r} has an empty name, directory or lockfile")
        if name in seen_names:
            raise SystemExit(f"{path}: duplicate workspace name {name!r}")
        seen_names.add(name)
        if lockfile in seen_lockfiles:
            raise SystemExit(f"{path}: duplicate lockfile {lockfile!r}")
        seen_lockfiles.add(lockfile)
        # The directory is where every leg runs, and the lockfile is what the GHSA
        # leg scans. If they disagreed, the gate would audit one workspace while
        # scanning another's dependencies and report both as covered.
        expected = "Cargo.lock" if directory == "." else f"{directory}/Cargo.lock"
        if lockfile != expected:
            raise SystemExit(
                f"{path}: workspace {name!r} declares lockfile {lockfile!r}, "
                f"but directory {directory!r} owns {expected!r}"
            )
    return rows


def discover_lockfiles(repo_root: Path) -> list[str]:
    """Every cargo lockfile git tracks, which is the set the gate owes coverage on.

    `git ls-files` rather than a filesystem walk on purpose: an uncommitted
    lockfile is not something a release ships, and a filesystem walk would also
    sweep vendored or build-output copies under `target/`.
    """
    completed = subprocess.run(
        ["git", "ls-files", "--", "*Cargo.lock"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise SystemExit(
            "git ls-files failed, so the audited-lockfile set cannot be established; "
            f"refusing to treat that as full coverage:\n{completed.stderr.strip()}"
        )
    return sorted(line for line in completed.stdout.splitlines() if line.strip())


def check(manifest: Path, repo_root: Path) -> tuple[list[dict], list[str]]:
    rows = load_workspaces(manifest)
    declared = {row["lockfile"] for row in rows}
    committed = set(discover_lockfiles(repo_root))

    errors: list[str] = []
    for lockfile in sorted(committed - declared):
        errors.append(
            f"{lockfile} is committed but has no row in {manifest.name}. Nothing audits it. "
            "Add a row classifying its workspace, or delete the lockfile."
        )
    for lockfile in sorted(declared - committed):
        errors.append(
            f"{lockfile} has a row in {manifest.name} but git does not track it. "
            "Delete the row, or commit the lockfile."
        )
    return rows, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).resolve().parent / "audited-workspaces.toml",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    parser.add_argument(
        "--print",
        dest="print_rows",
        action="store_true",
        help="emit name<TAB>directory<TAB>lockfile rows on stdout once the check passes",
    )
    args = parser.parse_args()

    rows, errors = check(args.manifest, args.repo_root)

    # The report goes to stderr so `--print` keeps stdout machine-readable for the
    # gate script that consumes it.
    print(
        f"audited cargo workspaces: {len(rows)} declared, "
        f"{len(discover_lockfiles(args.repo_root))} lockfiles committed",
        file=sys.stderr,
    )
    for row in rows:
        print(f"  {row['name']:8s} {row['lockfile']}", file=sys.stderr)

    if errors:
        print(
            "\nFAIL: the supply-chain gate's lockfile coverage does not match the repository.\n"
            "Every committed cargo lockfile must be classified in "
            "tools/ci/audited-workspaces.toml,\nbecause the gate audits exactly what that "
            "file declares and nothing else.",
            file=sys.stderr,
        )
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1

    if args.print_rows:
        for row in rows:
            print(f"{row['name']}\t{row['directory']}\t{row['lockfile']}")
    else:
        print("\nOK: every committed cargo lockfile is classified and audited.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
