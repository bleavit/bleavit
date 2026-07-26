#!/usr/bin/env python3
"""Enforce 15 §4.5: generated weight files contain only generated weights.

A weight term hand-written into a ``frame-omni-bencher`` output is deleted by the
next regeneration, and the deletion presents as a weight **decrease** — the one
shape ``check-weight-regression.py`` is structurally unable to see, because it
gates growth.  SQ-490 found three live instances of this, one of them a
per-block hook and one understating three permissionless cranks by 2.4x.

Every function in a generated file therefore has to carry the generator's
``Minimum execution time:`` line.  A deliberate override is allowed, but only as
an annotated entry in ``generated-weight-overrides.toml`` — and the entry
**expires mechanically**: once the function is measured (or disappears) the stale
entry fails this gate, so an override cannot outlive its reason the way a code
comment can.

Run: ``python3 tools/ci/check-generated-weights.py``
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights"
OVERRIDES = Path(__file__).resolve().parent / "generated-weight-overrides.toml"

MEASURED_MARKER = "Minimum execution time:"
# Matches a weight function at impl-body indentation in a generated file.
FN_RE = re.compile(
    r"\n\tfn ([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*->\s*Weight\s*\{(.*?)\n\t\}",
    re.S,
)
ENTRY_RE = re.compile(r"^(\S+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S(?:.*\S)?)$")


class CheckError(RuntimeError):
    """A user-facing configuration or repository error."""


def load_overrides(path: Path = OVERRIDES) -> dict[tuple[str, str], str]:
    if not path.is_file():
        return {}
    overrides: dict[tuple[str, str], str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = ENTRY_RE.match(line)
        if not match:
            raise CheckError(
                f"{path.name}:{number}: expected '<path> <function>: <justification>'"
            )
        rel, function, justification = match.groups()
        key = (rel, function)
        if key in overrides:
            raise CheckError(f"{path.name}:{number}: duplicate entry for {rel}::{function}")
        overrides[key] = justification
    return overrides


def scan(weights_dir: Path = WEIGHTS) -> dict[tuple[str, str], bool]:
    """Map (repo-relative path, function) -> whether it carries a measured line."""
    found: dict[tuple[str, str], bool] = {}
    if not weights_dir.is_dir():
        return found
    for path in sorted(weights_dir.glob("*.rs")):
        if path.name == "mod.rs":
            continue
        try:
            rel = path.relative_to(ROOT).as_posix()
        except ValueError:
            # Scanned outside the repo (the unit tests use a temporary tree).
            rel = path.relative_to(weights_dir).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in FN_RE.finditer(text):
            found[(rel, match.group(1))] = MEASURED_MARKER in match.group(2)
    return found


def evaluate(
    found: dict[tuple[str, str], bool], overrides: dict[tuple[str, str], str]
) -> tuple[list[str], list[str], int]:
    unannotated: list[str] = []
    stale: list[str] = []
    for key, measured in sorted(found.items()):
        if not measured and key not in overrides:
            unannotated.append(f"{key[0]}::{key[1]}")
    for key in sorted(overrides):
        if key not in found:
            stale.append(f"{key[0]}::{key[1]} (function no longer present)")
        elif found[key]:
            stale.append(f"{key[0]}::{key[1]} (now carries a measured value)")
    return unannotated, stale, len(found)


def main(argv: list[str]) -> int:
    del argv
    try:
        overrides = load_overrides()
    except CheckError as error:
        print(f"generated-weights: {error}", file=sys.stderr)
        return 2
    found = scan()
    unannotated, stale, total = evaluate(found, overrides)

    for entry in unannotated:
        print(
            f"HAND-WRITTEN WEIGHT: {entry} carries no '{MEASURED_MARKER}' line. "
            "Generated files hold only generated weights (15 §4.5): benchmark the "
            "term and compose it at the call site, or record a justified override "
            "in tools/ci/generated-weight-overrides.toml.",
            file=sys.stderr,
        )
    for entry in stale:
        print(
            f"STALE OVERRIDE: {entry}. Overrides expire mechanically — remove the "
            "entry from tools/ci/generated-weight-overrides.toml.",
            file=sys.stderr,
        )
    if unannotated or stale:
        return 1

    print(
        f"generated weights: {total} functions checked, "
        f"{len(overrides)} justified override(s)."
    )
    for (rel, function), justification in sorted(overrides.items()):
        print(f"  override {rel}::{function}: {justification}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
