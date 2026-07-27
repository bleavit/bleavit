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

# The generator emits a small, fixed grammar. Consuming exactly that grammar and
# then asking whether any letters are left is how a term *spliced into an already
# generated function* gets caught — that function keeps its `Minimum execution
# time:` line, so the marker check above passes it. Both halves matter: the
# original SQ-490 defect was a hand-written function (no marker) **plus** three
# `.saturating_add(Self::collator_compensation())` calls inside functions that
# did have one, and a marker-only check sees just the first half.
INT = r"\d[\d_]*(?:_?u64)?"
GENERATED_CONSTRUCTS = (
    # Comments carry the measured summary and the Standard Error notes.
    re.compile(r"//[^\n]*"),
    # A component-scaled term: `.saturating_mul(n.into())` / `(n as u64)`.
    re.compile(
        r"\.\s*saturating_mul\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*"
        r"(?:\.\s*into\s*\(\s*\)|as\s+u64)\s*\)"
    ),
    re.compile(rf"Weight\s*::\s*from_parts\s*\(\s*{INT}\s*,\s*{INT}\s*\)"),
    re.compile(r"Weight\s*::\s*MAX"),
    re.compile(r"(?:T\s*::\s*DbWeight|RocksDbWeight)\s*::\s*get\s*\(\s*\)"),
    re.compile(rf"\.\s*(?:reads|writes)\s*\(\s*\(?\s*{INT}\s*\)?\s*\)"),
    re.compile(r"\.\s*(?:reads|writes)\s*\(\s*\(?\s*\)?\s*\)"),
    re.compile(r"\.\s*saturating_add\s*\("),
)
# What may legally remain once the grammar above is consumed.
RESIDUE_RE = re.compile(r"[A-Za-z]")


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


def spliced_residue(body: str) -> str:
    """Return whatever is left of a body after the generator's own grammar.

    Empty means the body is pure generator output. Anything alphabetic means a
    term was written by hand — the shape a regeneration silently deletes.
    """
    remainder = body
    for pattern in GENERATED_CONSTRUCTS:
        remainder = pattern.sub(" ", remainder)
    if not RESIDUE_RE.search(remainder):
        return ""
    return " ".join(remainder.split())


def scan(weights_dir: Path = WEIGHTS) -> dict[tuple[str, str], bool]:
    """Map (repo-relative path, function) -> whether it is pure generator output.

    A function counts as generated only if it carries the generator's measured
    line **and** its body contains nothing outside the generator's grammar.
    """
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
            body = match.group(2)
            pure = MEASURED_MARKER in body and not spliced_residue(body)
            found[(rel, match.group(1))] = pure
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
    # Pass `WEIGHTS` explicitly: `scan`'s default argument binds at definition
    # time, so the module constant is the single source of truth only if the call
    # site reads it (audit 2026-07-27, AUD-3).
    found = scan(WEIGHTS)
    # A gate that finds nothing to check MUST NOT report a pass (audit
    # 2026-07-27, AUD-3). `scan` returns an empty map both when the weights
    # directory is absent and when it holds no parsable weight function, so a
    # moved/renamed directory or a regex that stops matching the generator's
    # output would have printed "0 functions checked" and exited 0 — the same
    # vacuous-pass shape 15 §5 already forbids for an empty artifact inventory.
    if not found:
        print(
            f"generated-weights: no weight function found under {WEIGHTS}. "
            "This gate cannot pass without an inventory to check — verify the "
            "weights directory and the generator's output grammar.",
            file=sys.stderr,
        )
        return 2
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
