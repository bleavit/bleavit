"""The fail-closed osv-scanner driver, shared by every supply-chain checker.

Two checkers consume `osv-scanner` JSON and they reach opposite verdicts on the
same input, because their ecosystems differ:

  * `tools/ci/check-ghsa-only.py` gates cargo lockfiles and deliberately SKIPS
    every finding RustSec carries, because `cargo-audit` gates those.
  * `tools/ci/check-npm-advisories.py` gates npm lockfiles and skips nothing,
    because no second scanner stands behind it.

What both share is how the scanner is run and how a failed run is treated. That
part is ecosystem-neutral and lives here, so there is exactly one place where the
rule "a scan that did not happen is not a clean scan" is written down.

Keeping it here also stops the npm checker from importing the crates.io-scoped
one for a function that has nothing to do with crates.io.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


# osv-scanner v2 exit codes. 0 and 1 both mean "the lockfile was scanned" — 1
# only adds "and something was found", which is a checker's input, not its
# verdict. Every other code is a failure to scan (127 general error, 128 no
# package sources), and MUST NOT be read as "nothing found": that would turn an
# unreachable OSV API or a mistyped lockfile path into a silently green security
# gate. Verified against v2.4.0: a vulnerable lockfile exits 1 with JSON; a
# missing, empty, or package-less lockfile exits 127 with no stdout at all.
SCAN_OK = frozenset({0, 1})


def scan(scanner: str, lockfile: Path) -> dict:
    """Scan one lockfile, or exit non-zero. Never returns an empty report.

    `osv-scanner` decides the ecosystem from the lockfile's own name, so the
    same invocation serves `Cargo.lock` and `pnpm-lock.yaml`. Verified against
    the pinned v2.4.0: `app/pnpm-lock.yaml` extracts 455 npm packages.
    """
    proc = subprocess.run(
        [scanner, "scan", "source", f"--lockfile={lockfile}", "--format=json"],
        capture_output=True,
        text=True,
    )
    if proc.returncode not in SCAN_OK:
        sys.exit(
            f"osv-scanner failed to scan {lockfile} (exit {proc.returncode}); refusing to\n"
            f"treat a failed scan as a clean one:\n{proc.stderr.strip()[-2000:]}"
        )
    if not proc.stdout.strip():
        sys.exit(f"osv-scanner produced no output for {lockfile}:\n{proc.stderr}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        sys.exit(f"osv-scanner output for {lockfile} is not JSON ({exc}):\n{proc.stdout[:2000]}")
