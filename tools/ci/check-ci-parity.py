#!/usr/bin/env python3
"""Detect gates that pass in a developer worktree but fail in CI's checkout.

Motivated by a real escape (batch X wave 1, 2026-07-21). `check-weight-regression.py`
was added to `rust-workspace-gates.sh`; it defaults its comparison base to
`git merge-base HEAD origin/main`. The dedicated `Weight regression` CI job checks
out with `fetch-depth: 0`, so the ref resolves there — but the Rust job uses a bare
`actions/checkout@v7`, which fetches only the triggering commit. `origin/main` does
not exist in that checkout, the checker exited 2 with "Not a valid object name
origin/main", and the canonical Rust gate failed for a reason unrelated to the code.

The local gate run was green throughout, because the developer worktree *had*
`origin/main` fetched. That is the structural blind spot this checker closes: running
the same script locally is not the same as running it in CI, and no amount of care
about *what* the scripts do will surface a dependency on *where* they run.

## What this checks

Parity, not correctness. It runs each environment-sensitive gate command twice —
once in the working tree, once in a shallow single-branch clone that mimics
`actions/checkout@v7`'s defaults — and reports any command whose exit status
**diverges**. A command that fails in both places is a real failure that the
ordinary gate run already owns, and is reported separately as context, not as a
parity defect.

## What it does not check

- Compilation. Cargo commands are deliberately excluded: a cold build in a scratch
  clone costs 30-60 minutes and would not surface this bug class anyway.
- CI-only jobs with no local equivalent (TLC model checking, full-count property
  suites, benchmark smoke, the 10M-point sweep, supply-chain network probes).
- Anything about the CI runner image itself — toolchain pins, installed system
  libraries, available memory.
- A guarded and an unguarded invocation of the same checker *within one script*.
  Guards are recognised by matching the guard's own source pattern anywhere in
  the file, so a second, bare call in that same script is indistinguishable from
  the guarded one. Across different scripts this is handled — see
  `gate_commands`. Keep one call site per checker per script.

A green run means "no gate depends on state that only your worktree has". It does
not mean "CI will pass".
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Gate scripts scanned for embedded checker invocations. A `python3 tools/...`
# line inside one of these is exactly how the weight-regression checker entered
# the Rust gate, so discovering them mechanically keeps this honest as the gate
# scripts grow.
GATE_SCRIPTS = (
    "tools/ci/rust-workspace-gates.sh",
    "tools/ci/fuzz-gates.sh",
    "tools/ci/property-gates.sh",
    "tools/ci/supply-chain-gates.sh",
)

# Standalone gates the CI docs/tooling jobs run directly.
STANDALONE_GATES: tuple[tuple[str, ...], ...] = (
    ("python3", "tools/ci/check-doc-links.py"),
    ("python3", "tools/ci/check-plan-tables.py"),
    ("python3", "tools/ci/check-spec-question-batches.py"),
    ("python3", "tools/deploy/check-runbooks.py"),
    ("python3", "tools/limit-coverage/check-limit-coverage.py"),
    ("python3", "tools/monitoring/check_alert_coverage.py"),
    ("python3", "tools/reference-model/check-doc-table.py"),
    ("python3", "tools/reference-model/generate-vectors.py", "--check"),
    ("python3", "tools/env/validate-environments.py"),
)

# Commands that cannot run in a scratch clone for reasons unrelated to this bug
# class. Each needs a reason; an unexplained skip is how a gate quietly stops
# being checked.
SKIP: dict[str, str] = {
    "tools/ci/check-ghsa-only.py": "requires network access to the GitHub Advisory DB",
}

# Call sites whose enclosing script already handles the missing state, keyed by
# (script, checker) so that a *new* unguarded invocation of the same checker in
# some other script still fails the run.
#
# Each entry carries the guard's own source pattern, and the suppression only
# applies while that pattern is actually present in the script. An allowlist that
# merely asserts "this one is fine" can be silently defeated by deleting the
# guard it vouches for — which would rebuild, inside this checker, exactly the
# false confidence it exists to prevent. The suppression must expire on its own
# when the guard goes away.
GUARDED: dict[tuple[str, str], tuple[str, str]] = {
    (
        "tools/ci/rust-workspace-gates.sh",
        "tools/ci/check-weight-regression.py",
    ): (
        r"rev-parse\s+--verify\s+--quiet\s+origin/main",
        "guarded on `git rev-parse --verify --quiet origin/main`, which skips loudly "
        "when the ref is absent; authoritative enforcement is the `Weight regression` "
        "CI job, which checks out with fetch-depth: 0",
    ),
}

INVOCATION_RE = re.compile(r"^\s*python3\s+(tools/[^\s|&;]+(?:\s+--[^\s|&;]+)*)", re.M)


@dataclass(frozen=True)
class Gate:
    command: tuple[str, ...]
    origin: str  # the gate script it came from, or "(standalone)"
    guard_reason: str | None = None

    @property
    def checker(self) -> str:
        return self.command[1]


def resolve_guard(root: Path, origin: str, checker: str) -> str | None:
    """Return the documented reason only if the guard is still in the script.

    A suppression that outlives its guard is a lie the checker tells itself.
    """
    entry = GUARDED.get((origin, checker))
    if entry is None:
        return None
    pattern, reason = entry
    script = root / origin
    if not script.is_file():
        return None
    if not re.search(pattern, script.read_text()):
        return None
    return reason


@dataclass(frozen=True)
class Result:
    gate: Gate
    tree_ok: bool
    clone_ok: bool
    clone_output: str

    @property
    def command(self) -> tuple[str, ...]:
        return self.gate.command

    @property
    def _breaks_in_clone(self) -> bool:
        return self.tree_ok and not self.clone_ok

    @property
    def diverged(self) -> bool:
        """Breaks in a CI-shaped checkout and the call site does not handle it."""
        return self._breaks_in_clone and self.gate.guard_reason is None

    @property
    def guarded(self) -> bool:
        """Breaks standalone, but the enclosing script guards the invocation."""
        return self._breaks_in_clone and self.gate.guard_reason is not None

    @property
    def failed_both(self) -> bool:
        return not self.tree_ok and not self.clone_ok


def discover_embedded(root: Path) -> list[Gate]:
    """Extract `python3 tools/...` invocations from the shell gate scripts."""
    found: list[Gate] = []
    for rel in GATE_SCRIPTS:
        script = root / rel
        if not script.is_file():
            continue
        for match in INVOCATION_RE.finditer(script.read_text()):
            command = ("python3", *match.group(1).split())
            gate = Gate(command, rel, resolve_guard(root, rel, command[1]))
            if gate not in found:
                found.append(gate)
    return found


def gate_commands(root: Path) -> list[Gate]:
    """Collect every call site, collapsing only the ones handled identically.

    The dedup key is `(command, guard_reason)` — not the command alone. Two call
    sites for the same checker collapse only when they carry the same guard
    handling, so a checker that is guarded in one script and *unguarded* in
    another is evaluated at both sites and the unguarded one can still fail the
    run.

    Keying on the command alone was a false negative of exactly the kind this
    checker exists to catch: `rust-workspace-gates.sh` is scanned first and
    carries the guarded `check-weight-regression.py`, so an unguarded copy added
    to a later gate script was discarded before `resolve_guard` was ever
    consulted, and the run reported the guarded site as handled and passed.

    Script-discovered entries still come first, so a command that is also in
    STANDALONE_GATES keeps the script origin carrying its guard context.
    """
    gates: list[Gate] = []
    seen: set[tuple[tuple[str, ...], str | None]] = set()
    standalone = [Gate(c, "(standalone)") for c in STANDALONE_GATES]
    for gate in (*discover_embedded(root), *standalone):
        key = (gate.command, gate.guard_reason)
        if key in seen:
            continue
        seen.add(key)
        gates.append(gate)
    return [g for g in gates if not any(part in SKIP for part in g.command)]


def current_branch(root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    branch = result.stdout.strip()
    if result.returncode != 0 or not branch or branch == "HEAD":
        raise SystemExit(
            "check-ci-parity: HEAD is detached or unreadable; check out a branch first."
        )
    return branch


def make_shallow_clone(root: Path, destination: Path) -> None:
    """Clone the way `actions/checkout@v7` does by default.

    Depth 1, single branch, no tags — so no other remote-tracking ref (notably
    `origin/main`) exists. That is precisely the shape that broke the Rust gate.
    """
    branch = current_branch(root)
    result = subprocess.run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--single-branch",
            "--no-tags",
            "--branch",
            branch,
            f"file://{root}",
            str(destination),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"check-ci-parity: shallow clone failed:\n{result.stderr}")


def run(command: tuple[str, ...], cwd: Path) -> tuple[bool, str]:
    result = subprocess.run(
        list(command), cwd=cwd, capture_output=True, text=True, check=False
    )
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output


def evaluate(root: Path, clone: Path, gates: list[Gate]) -> list[Result]:
    results = []
    for gate in gates:
        if not (root / gate.checker).is_file():
            continue
        tree_ok, _ = run(gate.command, root)
        clone_ok, clone_output = run(gate.command, clone)
        results.append(Result(gate, tree_ok, clone_ok, clone_output))
    return results


def report(results: list[Result]) -> int:
    diverged = [r for r in results if r.diverged]
    guarded = [r for r in results if r.guarded]
    both = [r for r in results if r.failed_both]

    for result in results:
        if result.diverged:
            mark = "DIVERGED"
        elif result.guarded:
            mark = "guarded"
        elif result.failed_both:
            mark = "FAIL-BOTH"
        else:
            mark = "ok"
        print(f"  [{mark:>9}] {' '.join(result.command)}")

    if guarded:
        print(
            "\nEnvironment-dependent, but handled at the call site "
            "(the standalone command does fail in a CI-shaped checkout):"
        )
        for result in guarded:
            print(f"  - {' '.join(result.command)}")
            print(f"      in {result.gate.origin}: {result.gate.guard_reason}")

    if both:
        print(
            "\nFailing in BOTH the worktree and the clone "
            "(a real gate failure, not a parity defect — the ordinary gate run owns these):"
        )
        for result in both:
            print(f"  - {' '.join(result.command)}")

    if diverged:
        print("\nENVIRONMENT-DEPENDENT GATES (pass in your worktree, fail in CI's checkout):")
        for result in diverged:
            print(f"\n  $ {' '.join(result.command)}   [from {result.gate.origin}]")
            for line in result.clone_output.splitlines()[-6:]:
                print(f"    {line}")
        print(
            "\nFAIL: the gates above depend on state your worktree has and CI's shallow\n"
            "checkout does not. Fetch the ref explicitly in the CI job, pass an explicit\n"
            "base, or guard the invocation — do not rely on the local run staying green."
        )
        return 1

    print(f"\nPASS: {len(results)} gate(s) behave identically in a CI-shaped checkout.")
    print("(Parity only — this does not mean CI will pass.)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keep-clone",
        action="store_true",
        help="leave the scratch clone in place for inspection",
    )
    args = parser.parse_args()

    commands = gate_commands(ROOT)
    if not commands:
        print("check-ci-parity: no gate commands discovered.")
        return 0

    destination = Path(tempfile.mkdtemp(prefix="bleavit-ci-parity-"))
    clone = destination / "repo"
    try:
        make_shallow_clone(ROOT, clone)
        print(f"Shallow clone (actions/checkout@v7 shape): {clone}")
        has_main = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", "origin/main"],
            cwd=clone,
            capture_output=True,
            check=False,
        ).returncode == 0
        print(f"origin/main present in clone: {'yes' if has_main else 'no (as in CI)'}\n")
        results = evaluate(ROOT, clone, commands)
        return report(results)
    finally:
        if args.keep_clone:
            print(f"\nScratch clone retained at {clone}")
        else:
            shutil.rmtree(destination, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
