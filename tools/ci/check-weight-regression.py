#!/usr/bin/env python3
"""Gate committed FRAME weight diffs against Bleavit's regression budget.

Architecture 15 §4.5 requires CI to reject weight regressions greater than 10%
and to track PoV size against architecture 13's budgets. This deterministic gate
compares committed generated weights; it never re-runs wall-clock benchmarks on
heterogeneous CI machines.

Generated omni-bencher weights are linear expressions, not single constants. The
parser therefore sums every non-multiplied ``Weight::from_parts`` term, captures
per-component ref-time/proof slopes, component high bounds, and fixed plus linear
database reads/writes. The gate evaluates ref-time, proof size, reads, and writes
at each revision's declared worst-case component bounds and applies the §4.5
greater-than-10% rule to those four totals. Absolute changes of at most 1,000,000
ps, 1,024 proof bytes, or one database read/write are tolerated as small floors.
This prevents a numerically small slope from hiding a large bounded-range cost.

New weights are allowed, but a removed function or file can hide a rename or move
and therefore fails unless explicitly acknowledged. Intentional regressions and
removals require a scoped entry in weight-regression-acks.toml; stale entries fail.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ACK_FILE = ROOT / "tools" / "ci" / "weight-regression-acks.toml"
LIMIT_NUMERATOR = 110
LIMIT_DENOMINATOR = 100
# Absolute-delta floors. `exceeds_limit` requires BOTH a >10% relative move and a
# delta above the floor, so these decide what counts as signal.
#
# ref_time's floor is 250 µs, raised from 1 µs by SQ-490 on measured evidence. The
# 21-pallet sweep produced 38 regressed functions; replaying the gate over them
# shows every function with a *real* change also moved a storage dimension, while
# every ref_time-only mover had a delta of 1–48 µs. The largest ref_time-only
# delta (47.8 µs) is *above* the smallest storage-flagged one (4.8 µs), so the two
# populations are not separable by ref_time at all and are perfectly separable by
# storage. Any floor in 100–500 µs yields the identical verdict on that data; 250
# µs is the midpoint. At 1 µs the gate was a jitter detector that cost a reviewer
# an acknowledgement per run — the same benchmark on the same wasm minutes apart
# moved a sub-millisecond call by 127%.
#
# ref_time therefore acts as a backstop for a large move that touches no storage;
# reads/writes/proof_size stay the primary signal and are reproducible (two
# independent regenerations hours apart produced byte-identical storage
# dimensions while ref_time drifted on its own).
REF_TIME_FLOOR = 250_000_000
PROOF_SIZE_FLOOR = 1_024
DB_ACCESS_FLOOR = 1

# Only the runtime's generated weight files are gated: they are the weights the
# chain actually dispatches with (configs.rs points every pallet at them). The
# per-pallet `pallets/*/src/weights.rs` files are macro-based mock placeholders
# whose constants are not extractable per-function and are not consensus
# weights; gating them would silently compare nothing. `mod.rs` carries no
# weights.
WEIGHT_PATH_RES = (
    re.compile(r"^runtime/bleavit-runtime/src/weights/(?!mod\.rs$)[^/]+\.rs$"),
)
WEIGHT_IMPL_RE = re.compile(
    r"\bimpl\b[^\{;]*\bWeightInfo\s+for\s+[^\{;]+\{", re.DOTALL
)
WEIGHT_FN_RE = re.compile(
    r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^\{;]*?\)\s*->\s*Weight\s*\{",
    re.DOTALL,
)
INTEGER_RE = r"([0-9][0-9_]*)(?:u64)?"
FROM_PARTS_RE = re.compile(
    r"Weight\s*::\s*from_parts\s*\(\s*"
    + INTEGER_RE
    + r"\s*,\s*"
    + INTEGER_RE
    + r"\s*\)"
)
SLOPE_RE = re.compile(
    r"Weight\s*::\s*from_parts\s*\(\s*"
    + INTEGER_RE
    + r"\s*,\s*"
    + INTEGER_RE
    + r"\s*\)\s*"
    r"\.\s*saturating_mul\s*\(\s*"
    r"([A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*into\s*\(\s*\)|\s+as\s+u64)"
    r"\s*\)"
)
RANGE_RE = re.compile(
    r"///\s*The range of component\s+`([A-Za-z_][A-Za-z0-9_]*)`\s+is\s+"
    r"`\[\s*([0-9][0-9_]*)\s*,\s*([0-9][0-9_]*)\s*\]`\."
)
DB_FIXED_RE = re.compile(
    r"(?:[A-Za-z_][A-Za-z0-9_]*\s*::\s*)?DbWeight\s*::\s*get\s*\(\s*\)\s*"
    r"\.\s*(reads|writes)\s*\(\s*"
    + INTEGER_RE
    + r"\s*\)"
)
DB_SLOPE_RE = re.compile(
    r"(?:[A-Za-z_][A-Za-z0-9_]*\s*::\s*)?DbWeight\s*::\s*get\s*\(\s*\)\s*"
    r"\.\s*(reads|writes)\s*\(\s*\(\s*"
    + INTEGER_RE
    + r"\s*\)\s*\.\s*saturating_mul\s*\(\s*"
    r"([A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*into\s*\(\s*\)|\s+as\s+u64)"
    r"\s*\)\s*\)"
)
# `<path> <function-or-*> [@ dim=value, ...]: <justification>`
#
# The optional `@` clause pins the accepted head values. Pinning is what makes an
# *obsolete* acknowledgement safe to merely warn about instead of failing: an
# unpinned entry authorizes any future regression on that function, so leaving one
# lying around would let a later, different regression inherit an old
# justification. With pins, a changed regression no longer matches and fails.
ACK_RE = re.compile(
    r"^(\S+)\s+(\*|[A-Za-z_][A-Za-z0-9_]*)\s*"
    r"(?:@\s*([^:]*?)\s*)?:\s*(\S(?:.*\S)?)$"
)
PIN_RE = re.compile(r"^([a-z_]+)\s*=\s*(\d[\d_]*)$")
PINNABLE = ("ref_time", "proof_size", "reads", "writes")
# `@ removed` in place of pins: authorizes a deletion, never a regression.
REMOVAL_MARKER = "removed"


class CheckError(RuntimeError):
    """A user-facing configuration or repository error."""


@dataclass(frozen=True)
class FunctionWeight:
    ref_time: int
    proof_size: int
    slopes: dict[str, tuple[int, int]] = field(default_factory=dict)
    reads: int = 0
    writes: int = 0
    read_slopes: dict[str, int] = field(default_factory=dict)
    write_slopes: dict[str, int] = field(default_factory=dict)
    ranges: dict[str, tuple[int, int]] = field(default_factory=dict)

    def worst_case_totals(self) -> dict[str, int]:
        components = (
            set(self.slopes) | set(self.read_slopes) | set(self.write_slopes)
        )
        missing_ranges = sorted(components - set(self.ranges))
        if missing_ranges:
            raise CheckError(
                "linear weight component(s) have no generated range: "
                + ", ".join(missing_ranges)
            )
        ref_time = self.ref_time
        proof_size = self.proof_size
        reads = self.reads
        writes = self.writes
        for component, (_, high) in self.ranges.items():
            ref_slope, proof_slope = self.slopes.get(component, (0, 0))
            ref_time += ref_slope * high
            proof_size += proof_slope * high
            reads += self.read_slopes.get(component, 0) * high
            writes += self.write_slopes.get(component, 0) * high
        return {
            "worst_case.ref_time": ref_time,
            "worst_case.proof_size": proof_size,
            "worst_case.reads": reads,
            "worst_case.writes": writes,
        }


@dataclass(frozen=True)
class Regression:
    quantity: str
    base: int
    head: int


@dataclass(frozen=True)
class Acknowledgement:
    """A justified acceptance of one function's regression, or of its removal."""

    justification: str
    pins: dict[str, int] = field(default_factory=dict)
    removal: bool = False

    def covers(self, regressions: list[Regression]) -> tuple[bool, str]:
        """Does this entry authorize exactly the regression that is present?"""
        if self.removal:
            # A removal entry is pinless by construction, so without this branch it
            # would fall into the pinless "authorizes anything" case below and
            # become a wildcard over *live* regressions — reopening precisely the
            # hole mandatory pinning closed, and doing it through the one form the
            # parser still lets you write without pins. `@ removed` authorizes a
            # deletion and nothing else.
            return False, (
                "'@ removed' authorizes a deletion, not a regression on a function "
                "that is still present; pin the accepted values instead"
            )
        if not self.pins:
            # Legacy unpinned entry: authorizes anything, which is why parsing
            # rejects it for function acknowledgements.
            return True, ""
        actual = {r.quantity.removeprefix("worst_case."): r.head for r in regressions}
        mismatched = [
            f"{dim}: pinned {self.pins[dim]:,} but measured "
            f"{actual.get(dim, 0):,}"
            for dim in sorted(self.pins)
            if actual.get(dim) != self.pins[dim]
        ]
        unpinned = sorted(set(actual) - set(self.pins))
        if unpinned:
            mismatched.append(
                "regression on unpinned dimension(s): " + ", ".join(unpinned)
            )
        return (not mismatched), "; ".join(mismatched)


@dataclass
class Comparison:
    unacknowledged: dict[tuple[str, str], list[Regression]] = field(default_factory=dict)
    acknowledged: dict[tuple[str, str], list[Regression]] = field(default_factory=dict)
    unacknowledged_removals: dict[tuple[str, str], str] = field(default_factory=dict)
    acknowledged_removals: dict[tuple[str, str], str] = field(default_factory=dict)
    # An entry whose function is gone: it may be masking a rename or a move, so
    # it stays fatal.
    stale_acks: dict[tuple[str, str], str] = field(default_factory=dict)
    # An entry whose function is still present but no longer regresses — the
    # regression landed in the baseline. Inert, because it is pinned. Warn only:
    # this is the state every acknowledgement reaches the moment its PR merges,
    # and failing on it cost thirteen manual prunes before SQ-490.
    obsolete_acks: dict[tuple[str, str], str] = field(default_factory=dict)
    # An entry that is present and active but whose pins do not match what was
    # measured. Fatal: the justification was written for a different number.
    mismatched_acks: dict[tuple[str, str], str] = field(default_factory=dict)
    notices: list[str] = field(default_factory=list)
    compared_functions: int = 0


@dataclass(frozen=True)
class BaseResolution:
    commit: str | None
    notices: tuple[str, ...] = ()


def matching_weight_path(path: str) -> bool:
    return any(pattern.fullmatch(path) for pattern in WEIGHT_PATH_RES)


def matching_brace(text: str, opening: int) -> int:
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    raise CheckError(f"unbalanced Rust braces at byte {opening}")


def parse_integer(value: str) -> int:
    return int(value.replace("_", ""))


def add_slope(slopes: dict[str, int], component: str, value: int) -> None:
    slopes[component] = slopes.get(component, 0) + value


def parse_weight_file(text: str) -> dict[str, FunctionWeight]:
    """Parse the last direct WeightInfo implementation in generated Rust."""
    parsed: dict[str, FunctionWeight] = {}
    for implementation in WEIGHT_IMPL_RE.finditer(text):
        impl_opening = text.find("{", implementation.start(), implementation.end())
        impl_closing = matching_brace(text, impl_opening)
        impl_body = text[impl_opening + 1 : impl_closing]
        implementation_functions: dict[str, FunctionWeight] = {}
        preceding_end = 0
        for function in WEIGHT_FN_RE.finditer(impl_body):
            name = function.group(1)
            opening_local = impl_body.find("{", function.start(), function.end())
            opening = impl_opening + 1 + opening_local
            closing = matching_brace(text, opening)
            closing_local = closing - (impl_opening + 1)
            documentation = impl_body[preceding_end : function.start()]
            preceding_end = closing_local + 1
            body = text[opening + 1 : closing]

            ranges: dict[str, tuple[int, int]] = {}
            for component_range in RANGE_RE.finditer(documentation):
                component = component_range.group(1)
                bounds = (
                    parse_integer(component_range.group(2)),
                    parse_integer(component_range.group(3)),
                )
                if component in ranges and ranges[component] != bounds:
                    raise CheckError(
                        f"conflicting ranges for component {component} in {name}"
                    )
                ranges[component] = bounds

            slope_matches = list(SLOPE_RE.finditer(body))
            slope_spans = [match.span() for match in slope_matches]
            ref_time = 0
            proof_size = 0
            for term in FROM_PARTS_RE.finditer(body):
                if any(start <= term.start() < end for start, end in slope_spans):
                    continue
                ref_time += parse_integer(term.group(1))
                proof_size += parse_integer(term.group(2))
            if not list(FROM_PARTS_RE.finditer(body)):
                continue

            slopes: dict[str, tuple[int, int]] = {}
            for slope in slope_matches:
                component = slope.group(3)
                old_ref_time, old_proof_size = slopes.get(component, (0, 0))
                slopes[component] = (
                    old_ref_time + parse_integer(slope.group(1)),
                    old_proof_size + parse_integer(slope.group(2)),
                )

            reads = 0
            writes = 0
            for access in DB_FIXED_RE.finditer(body):
                value = parse_integer(access.group(2))
                if access.group(1) == "reads":
                    reads += value
                else:
                    writes += value

            read_slopes: dict[str, int] = {}
            write_slopes: dict[str, int] = {}
            for access in DB_SLOPE_RE.finditer(body):
                value = parse_integer(access.group(2))
                component = access.group(3)
                if access.group(1) == "reads":
                    add_slope(read_slopes, component, value)
                else:
                    add_slope(write_slopes, component, value)

            function_weight = FunctionWeight(
                ref_time=ref_time,
                proof_size=proof_size,
                slopes=slopes,
                reads=reads,
                writes=writes,
                read_slopes=read_slopes,
                write_slopes=write_slopes,
                ranges=ranges,
            )
            # Validate now so malformed generated expressions cannot become a
            # comparison-time blind spot (including newly added functions).
            function_weight.worst_case_totals()
            implementation_functions[name] = function_weight

        # Generated files should have one live implementation. If a file also
        # contains a default/legacy implementation, the last one is authoritative.
        parsed = implementation_functions
    return parsed


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise CheckError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def resolve_base(requested: str | None) -> BaseResolution:
    revision = requested
    if revision is None:
        revision = run_git("merge-base", "HEAD", "origin/main").strip()
        if not revision:
            raise CheckError("git merge-base HEAD origin/main returned no revision")
    resolved = run_git("rev-parse", "--verify", f"{revision}^{{commit}}").strip()
    head = run_git("rev-parse", "--verify", "HEAD^{commit}").strip()
    if resolved != head:
        return BaseResolution(resolved)

    parent_line = run_git("rev-list", "--parents", "-n", "1", "HEAD").split()
    if len(parent_line) == 1:
        return BaseResolution(
            None,
            (
                "comparison base resolves to HEAD, but HEAD is the initial commit; "
                "no parent exists, so the weight-regression comparison is skipped",
            ),
        )
    return BaseResolution(
        parent_line[1],
        (
            "comparison base resolves to HEAD; falling back to HEAD~1 so a push "
            "to the main branch cannot compare the commit with itself",
        ),
    )


def base_weight_paths(base: str) -> set[str]:
    paths = run_git("ls-tree", "-r", "--name-only", base, "--", "runtime")
    return {path for path in paths.splitlines() if matching_weight_path(path)}


def working_weight_paths() -> set[str]:
    paths: set[str] = set()
    runtime_weights = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights"
    if runtime_weights.is_dir():
        paths.update(
            path.relative_to(ROOT).as_posix()
            for path in runtime_weights.glob("*.rs")
            if path.is_file() and path.name != "mod.rs"
        )
    return paths


def git_file(base: str, path: str) -> str:
    return run_git("show", f"{base}:{path}")


def parse_acknowledgements(text: str) -> dict[tuple[str, str], Acknowledgement]:
    acknowledgements: dict[tuple[str, str], Acknowledgement] = {}
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ACK_RE.fullmatch(line)
        if match is None:
            raise CheckError(
                f"{ACK_FILE.relative_to(ROOT)}:{line_number}: expected "
                "'<repo-relative-weight-path> <function-or-*> "
                "[@ dim=value, ...]: <justification>'"
            )
        path, function, pin_clause, justification = match.groups()
        if not matching_weight_path(path):
            raise CheckError(
                f"{ACK_FILE.relative_to(ROOT)}:{line_number}: not a discovered weight path: {path}"
            )
        pins: dict[str, int] = {}
        removal = False
        for raw_pin in (pin_clause or "").split(","):
            pin = raw_pin.strip()
            if not pin:
                continue
            # `@ removed` authorizes a *deletion*, which has no values to pin. It is
            # a separate authorization from a growth acknowledgement on purpose: a
            # justification written about a weight going up says nothing about the
            # function being deleted, and an obsolete growth entry lingering after
            # its PR merged must not silently absorb a later removal.
            if pin == REMOVAL_MARKER:
                removal = True
                continue
            pin_match = PIN_RE.fullmatch(pin)
            if pin_match is None:
                raise CheckError(
                    f"{ACK_FILE.relative_to(ROOT)}:{line_number}: expected "
                    f"'<dimension>=<integer>', got {pin!r}"
                )
            dimension, value = pin_match.groups()
            if dimension not in PINNABLE:
                raise CheckError(
                    f"{ACK_FILE.relative_to(ROOT)}:{line_number}: unknown dimension "
                    f"{dimension!r}; expected one of {', '.join(PINNABLE)}"
                )
            if dimension in pins:
                raise CheckError(
                    f"{ACK_FILE.relative_to(ROOT)}:{line_number}: duplicate pin "
                    f"for {dimension}"
                )
            pins[dimension] = parse_integer(value)
        # A file-removal entry (`*`) has no per-dimension values to pin. Every
        # function entry must pin, because an unpinned entry authorizes any future
        # regression on that function — and since obsolete entries now only warn,
        # an unpinned one could sit in the file and silently absorb a later,
        # unrelated regression under someone else's justification.
        if function != "*" and not pins and not removal:
            raise CheckError(
                f"{ACK_FILE.relative_to(ROOT)}:{line_number}: acknowledgement for "
                f"{path}::{function} must pin the accepted values, e.g. "
                "'@ reads=261, ref_time=828490000', or say '@ removed' to authorize a "
                "deletion. Run this checker without arguments and it prints the exact "
                "line to paste."
            )
        if removal and pins:
            raise CheckError(
                f"{ACK_FILE.relative_to(ROOT)}:{line_number}: '@ {REMOVAL_MARKER}' "
                "authorizes a deletion and cannot also pin values; a function is either "
                "gone or it regressed, never both"
            )
        key = (path, function)
        if key in acknowledgements:
            raise CheckError(
                f"{ACK_FILE.relative_to(ROOT)}:{line_number}: duplicate acknowledgement "
                f"for {path} {function}"
            )
        acknowledgements[key] = Acknowledgement(justification, pins, removal)
    return acknowledgements


def exceeds_limit(base: int, head: int, floor: int) -> bool:
    if head <= base or head - base <= floor:
        return False
    return head * LIMIT_DENOMINATOR > base * LIMIT_NUMERATOR


def compare_function(base: FunctionWeight, head: FunctionWeight) -> list[Regression]:
    base_totals = base.worst_case_totals()
    head_totals = head.worst_case_totals()
    floors = {
        "worst_case.ref_time": REF_TIME_FLOOR,
        "worst_case.proof_size": PROOF_SIZE_FLOOR,
        "worst_case.reads": DB_ACCESS_FLOOR,
        "worst_case.writes": DB_ACCESS_FLOOR,
    }
    return [
        Regression(quantity, base_totals[quantity], head_totals[quantity])
        for quantity in floors
        if exceeds_limit(base_totals[quantity], head_totals[quantity], floors[quantity])
    ]


def compare_weight_sets(
    base_files: dict[str, dict[str, FunctionWeight]],
    head_files: dict[str, dict[str, FunctionWeight]],
    acknowledgements: dict[tuple[str, str], str],
) -> Comparison:
    result = Comparison()
    active_acknowledgements: set[tuple[str, str]] = set()
    present_functions: set[tuple[str, str]] = set()
    for path in sorted(set(base_files) | set(head_files)):
        if path not in base_files:
            result.notices.append(f"NEW weight file allowed: {path}")
            continue
        if path not in head_files:
            key = (path, "*")
            detail = "weight file removed"
            entry = acknowledgements.get(key)
            if entry is not None:
                result.acknowledged_removals[key] = detail
                active_acknowledgements.add(key)
            else:
                result.unacknowledged_removals[key] = detail
            continue

        base_functions = base_files[path]
        head_functions = head_files[path]
        for function in sorted(set(base_functions) | set(head_functions)):
            key = (path, function)
            if function not in base_functions:
                result.notices.append(f"NEW weight function allowed: {path}::{function}")
                continue
            if function not in head_functions:
                detail = "weight function removed"
                entry = acknowledgements.get(key)
                # A *growth* acknowledgement must not authorize a deletion. Its
                # justification was written about a number going up and says
                # nothing about the function disappearing — and since obsolete
                # entries now only warn, one left behind after its PR merged would
                # otherwise sit there ready to absorb an unrelated later removal
                # under someone else's reasoning. Only `@ removed` authorizes this.
                if entry is not None and entry.removal:
                    result.acknowledged_removals[key] = detail
                    active_acknowledgements.add(key)
                else:
                    if entry is not None:
                        detail += (
                            " — the acknowledgement present pins values for a weight"
                            " *increase* and does not authorize a deletion; use"
                            " '@ removed: <why>'"
                        )
                        active_acknowledgements.add(key)
                    result.unacknowledged_removals[key] = detail
                continue
            result.compared_functions += 1
            present_functions.add(key)
            regressions = compare_function(base_functions[function], head_functions[function])
            if not regressions:
                continue
            entry = acknowledgements.get(key)
            if entry is None:
                result.unacknowledged[key] = regressions
                continue
            covered, reason = entry.covers(regressions)
            if covered:
                result.acknowledged[key] = regressions
                active_acknowledgements.add(key)
            else:
                # Present and active, but pinned to different numbers: the
                # justification was written for a regression that is not this one.
                result.mismatched_acks[key] = reason
                result.unacknowledged[key] = regressions

    for key, entry in acknowledgements.items():
        if key in active_acknowledgements or key in result.mismatched_acks:
            continue
        if key in present_functions or (key[1] == "*" and key[0] in head_files):
            # The function still exists and simply no longer regresses — the usual
            # post-merge state. Inert because it is pinned, so warn rather than fail.
            result.obsolete_acks[key] = entry.justification
        else:
            # The function or file is gone; the entry could be masking a rename or
            # a move, which is the case that must stay fatal.
            result.stale_acks[key] = entry.justification
    return result


def format_delta(regression: Regression) -> str:
    if regression.base == 0:
        change = "new from zero"
    else:
        percent = (regression.head - regression.base) * 100.0 / regression.base
        change = f"+{percent:.2f}%"
    return (
        f"{regression.quantity}: {regression.base:,} -> "
        f"{regression.head:,} ({change}; limit 10%)"
    )


def report_comparison(
    comparison: Comparison,
    acknowledgements: dict[tuple[str, str], Acknowledgement],
    base: str,
    file_count: int,
) -> bool:
    print(f"Weight regression base: {base}")
    print(
        f"Discovered {file_count} weight file(s); compared "
        f"{comparison.compared_functions} shared function(s)."
    )
    for notice in comparison.notices:
        print(f"NOTICE: {notice}")
    for key, detail in sorted(comparison.acknowledged_removals.items()):
        path, function = key
        print(
            f"ACKNOWLEDGED REMOVAL: {path}::{function}: {detail}; "
            f"{acknowledgements[key].justification}"
        )
    for key, regressions in sorted(comparison.acknowledged.items()):
        path, function = key
        print(
            f"ACKNOWLEDGED REGRESSION: {path}::{function}: "
            f"{acknowledgements[key].justification}"
        )
        for regression in regressions:
            print(f"  {format_delta(regression)}")
    for key, detail in sorted(comparison.unacknowledged_removals.items()):
        path, function = key
        print(f"REMOVAL: {path}::{function}: {detail}", file=sys.stderr)
    for key, regressions in sorted(comparison.unacknowledged.items()):
        path, function = key
        print(f"REGRESSION: {path}::{function}", file=sys.stderr)
        for regression in regressions:
            print(f"  {format_delta(regression)}", file=sys.stderr)
        if key in comparison.mismatched_acks:
            print(
                f"  PINNED VALUES DO NOT MATCH: {comparison.mismatched_acks[key]}",
                file=sys.stderr,
            )
        # Print the line to paste. Hand-transcribing four measured integers is
        # how a pinned acknowledgement would otherwise become a chore.
        pins = ", ".join(
            f"{r.quantity.removeprefix('worst_case.')}={r.head}" for r in regressions
        )
        print(
            f"  to accept: {path} {function} @ {pins}: <why this is intended>",
            file=sys.stderr,
        )
    for key, justification in sorted(comparison.obsolete_acks.items()):
        path, function = key
        print(
            f"OBSOLETE ACKNOWLEDGEMENT (not fatal — the regression is now in the "
            f"baseline, and the entry is pinned so it cannot absorb a different "
            f"one; delete it when convenient): {path}::{function}: {justification}"
        )
    for key, justification in sorted(comparison.stale_acks.items()):
        path, function = key
        print(
            f"STALE ACKNOWLEDGEMENT: {path}::{function} no longer exists in the "
            f"head weight files, so this entry may be masking a rename or a move: "
            f"{justification}",
            file=sys.stderr,
        )

    failed = bool(
        comparison.unacknowledged
        or comparison.unacknowledged_removals
        or comparison.stale_acks
    )
    if failed:
        print(
            "FAIL: weight regressions and removals require a current, "
            "value-pinned acknowledgement; an acknowledgement whose function has "
            "vanished must be removed.",
            file=sys.stderr,
        )
        return False
    if comparison.acknowledged or comparison.acknowledged_removals:
        print("PASS WITH ACKNOWLEDGEMENTS: all regressions/removals are justified.")
    else:
        print("PASS: no worst-case weight total regresses by more than 10%.")
    return True


FIXTURE_PATH = "runtime/bleavit-runtime/src/weights/pallet_example.rs"
FIXTURE_BASE = """
impl<T: frame_system::Config> pallet_example::WeightInfo for ExampleWeight<T> {
    /// The range of component `c` is `[1, 100]`.
    fn trade(c: u32) -> Weight {
        Weight::from_parts(10_000_000, 0)
            .saturating_add(Weight::from_parts(0, 1_000))
            .saturating_add(Weight::from_parts(10_000, 2).saturating_mul(c.into()))
            .saturating_add(T::DbWeight::get().reads(5))
            .saturating_add(T::DbWeight::get().reads((1_u64).saturating_mul(c.into())))
            .saturating_add(T::DbWeight::get().writes(2))
            .saturating_add(T::DbWeight::get().writes((2_u64).saturating_mul(c as u64)))
    }
}
"""


def replace_once(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"fixture term is not unique: {old}"
    return text.replace(old, new)


def fixture_comparison(
    head: str,
    acknowledgements: dict[tuple[str, str], Acknowledgement] | None = None,
) -> Comparison:
    return compare_weight_sets(
        {FIXTURE_PATH: parse_weight_file(FIXTURE_BASE)},
        {FIXTURE_PATH: parse_weight_file(head)},
        acknowledgements or {},
    )


def run_self_tests() -> None:
    key = (FIXTURE_PATH, "trade")
    parsed = parse_weight_file(FIXTURE_BASE)["trade"]

    # Split fixed terms and both generated DB slope casts parse in full.
    assert parsed.ref_time == 10_000_000
    assert parsed.proof_size == 1_000
    assert parsed.slopes == {"c": (10_000, 2)}
    assert parsed.reads == 5 and parsed.read_slopes == {"c": 1}
    assert parsed.writes == 2 and parsed.write_slopes == {"c": 2}
    assert parsed.ranges == {"c": (1, 100)}
    assert parsed.worst_case_totals() == {
        "worst_case.ref_time": 11_000_000,
        "worst_case.proof_size": 1_200,
        "worst_case.reads": 105,
        "worst_case.writes": 202,
    }

    proof_regression = fixture_comparison(
        replace_once(FIXTURE_BASE, "(0, 1_000)", "(0, 2_200)")
    )
    assert [r.quantity for r in proof_regression.unacknowledged[key]] == [
        "worst_case.proof_size"
    ]

    reads_regression = fixture_comparison(
        replace_once(FIXTURE_BASE, ".reads(5)", ".reads(18)")
    )
    assert [r.quantity for r in reads_regression.unacknowledged[key]] == [
        "worst_case.reads"
    ]

    one_extra_read = fixture_comparison(
        replace_once(FIXTURE_BASE, ".reads(5)", ".reads(6)")
    )
    assert not one_extra_read.unacknowledged

    # A raw slope delta below the ref-time floor still exceeds that floor after
    # evaluation at the generated high bound and must fail. The per-unit delta
    # here is 2.99 µs — well under the 250 µs floor — while the worst case at
    # c = 100 grows by 299 µs, which is over it. That contrast is the whole point
    # of the assertion, so the numbers are scaled to the floor rather than the
    # floor being weakened to suit them.
    slope_regression = fixture_comparison(
        replace_once(FIXTURE_BASE, "(10_000, 2)", "(3_000_000, 2)")
    )
    assert [r.quantity for r in slope_regression.unacknowledged[key]] == [
        "worst_case.ref_time"
    ]

    # A pinned acknowledgement covering exactly the measured proof size.
    proof_head = replace_once(FIXTURE_BASE, "(0, 1_000)", "(0, 2_200)")
    pinned = Acknowledgement("measured proof growth is intentional", {"proof_size": 2_400})
    acknowledged = fixture_comparison(proof_head, {key: pinned})
    assert key in acknowledged.acknowledged
    assert not acknowledged.stale_acks and not acknowledged.obsolete_acks
    assert not acknowledged.mismatched_acks

    # Pinned to a different number: the justification was written for another
    # regression, so it must NOT authorize this one.
    wrong_pin = Acknowledgement("stale number", {"proof_size": 9_999})
    mismatched = fixture_comparison(proof_head, {key: wrong_pin})
    assert key in mismatched.mismatched_acks
    assert key in mismatched.unacknowledged

    # A regression on a dimension the entry does not pin is not covered either.
    unpinned_dim = Acknowledgement("only pinned proof", {"proof_size": 2_400})
    reads_head = replace_once(FIXTURE_BASE, ".reads(5)", ".reads(18)")
    partial = fixture_comparison(reads_head, {key: unpinned_dim})
    assert key in partial.mismatched_acks

    # The post-merge state: function still present, regression now in the
    # baseline. Inert because pinned, so it warns and does NOT fail. This is what
    # removes the thirteen-times-repeated manual prune.
    obsolete = fixture_comparison(FIXTURE_BASE, {key: pinned})
    assert key in obsolete.obsolete_acks
    assert not obsolete.stale_acks

    # The dangerous case stays fatal: an entry naming something that is not in
    # the weight files at all.
    ghost_key = (FIXTURE_PATH, "function_that_never_existed")
    ghost = fixture_comparison(FIXTURE_BASE, {ghost_key: pinned})
    assert ghost_key in ghost.stale_acks
    assert ghost_key not in ghost.obsolete_acks

    # A *growth* acknowledgement does not authorize a deletion. Its justification
    # was written about a number going up, and since obsolete entries now only
    # warn, one left behind after its PR merged would otherwise sit there ready to
    # absorb an unrelated later removal under someone else's reasoning.
    growth_only = compare_weight_sets(
        {FIXTURE_PATH: parse_weight_file(FIXTURE_BASE)},
        {FIXTURE_PATH: {}},
        {key: pinned},
    )
    assert key in growth_only.unacknowledged_removals, growth_only
    assert key not in growth_only.acknowledged_removals
    assert "does not authorize a deletion" in growth_only.unacknowledged_removals[key]

    # `@ removed` is the authorization that does apply.
    removal_entry = Acknowledgement("the call was retired by an approved migration", {}, True)
    removal = compare_weight_sets(
        {FIXTURE_PATH: parse_weight_file(FIXTURE_BASE)},
        {FIXTURE_PATH: {}},
        {key: removal_entry},
    )
    assert key in removal.acknowledged_removals, removal
    assert not removal.stale_acks and not removal.obsolete_acks

    # …and it cannot double as a regression acknowledgement.
    try:
        parse_acknowledgements(f"{FIXTURE_PATH} trade @ removed, reads=5: both")
    except CheckError as error:
        assert "cannot also pin values" in str(error), error
    else:  # pragma: no cover - the raise above is the expected path
        raise AssertionError("'@ removed' with pins must be rejected")
    parsed_removal = parse_acknowledgements(f"{FIXTURE_PATH} trade @ removed: retired")
    assert parsed_removal[(FIXTURE_PATH, "trade")].removal

    # …and it is not a wildcard over a *live* regression. A removal entry is
    # pinless by construction, so without an explicit guard it would land in the
    # pinless "authorizes anything" branch — reopening the very hole mandatory
    # pinning closed, through the one form the parser still accepts without pins.
    live_regression = fixture_comparison(
        reads_head, {key: Acknowledgement("retired", {}, True)}
    )
    assert key in live_regression.unacknowledged, live_regression
    assert key not in live_regression.acknowledged
    assert "authorizes a deletion" in live_regression.mismatched_acks[key]

    # Parsing: a function entry must pin, a `*` file entry need not.
    try:
        parse_acknowledgements(f"{FIXTURE_PATH} trade: no pins")
    except CheckError as error:
        assert "must pin the accepted values" in str(error), error
    else:  # pragma: no cover - guard
        raise AssertionError("unpinned function acknowledgement must be rejected")
    assert parse_acknowledgements(f"{FIXTURE_PATH} *: pallet retired")[
        (FIXTURE_PATH, "*")
    ].pins == {}
    parsed_pins = parse_acknowledgements(
        f"{FIXTURE_PATH} trade @ reads=261, ref_time=828_490_000: measured"
    )[(FIXTURE_PATH, "trade")].pins
    assert parsed_pins == {"reads": 261, "ref_time": 828_490_000}
    try:
        parse_acknowledgements(f"{FIXTURE_PATH} trade @ bogus=1: x")
    except CheckError as error:
        assert "unknown dimension" in str(error), error
    else:  # pragma: no cover - guard
        raise AssertionError("unknown pin dimension must be rejected")

    # The measured jitter band: a ref_time-only move under the floor is not a
    # regression at all, so it needs no acknowledgement. 48 µs was the largest
    # ref_time-only delta in the SQ-490 sweep.
    jitter = fixture_comparison(
        replace_once(FIXTURE_BASE, "from_parts(10_000_000", "from_parts(58_000_000")
    )
    assert not jitter.unacknowledged, jitter.unacknowledged

    new_function_text = FIXTURE_BASE.replace(
        "\n}\n",
        "\n    fn newly_added() -> Weight { Weight::from_parts(99_000_000, 9_900) }\n}\n",
    )
    new_function = fixture_comparison(new_function_text)
    assert not new_function.unacknowledged
    assert any("newly_added" in notice for notice in new_function.notices)

    removed_text = replace_once(
        FIXTURE_BASE,
        "    fn trade(c: u32) -> Weight {",
        "    fn renamed(c: u32) -> Weight {",
    )
    removed = fixture_comparison(removed_text)
    assert key in removed.unacknowledged_removals
    removed_acknowledged = fixture_comparison(
        removed_text,
        {key: Acknowledgement("renamed with an audited call mapping", {}, True)},
    )
    assert key in removed_acknowledged.acknowledged_removals
    assert not removed_acknowledged.stale_acks

    file_key = (FIXTURE_PATH, "*")
    file_removed = compare_weight_sets(
        {FIXTURE_PATH: parse_weight_file(FIXTURE_BASE)}, {}, {}
    )
    assert file_key in file_removed.unacknowledged_removals
    file_removed_acknowledged = compare_weight_sets(
        {FIXTURE_PATH: parse_weight_file(FIXTURE_BASE)},
        {},
        {file_key: Acknowledgement("pallet retired by approved migration")},
    )
    assert file_key in file_removed_acknowledged.acknowledged_removals
    parsed_file_ack = parse_acknowledgements(
        f"{FIXTURE_PATH} *: pallet retired by approved migration\n"
    )
    assert parsed_file_ack[file_key].justification == "pallet retired by approved migration"
    assert parsed_file_ack[file_key].pins == {}

    # A second implementation must replace, not be masked by, the first.
    last_impl = parse_weight_file(
        FIXTURE_BASE
        + FIXTURE_BASE.replace("10_000_000", "12_000_000", 1)
    )["trade"]
    assert last_impl.ref_time == 12_000_000

    frame_system = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights" / "frame_system.rs"
    pallet_market = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights" / "pallet_market.rs"
    pallet_epoch = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights" / "pallet_epoch.rs"
    # Structural checks only against the committed generated files: the exact
    # constants change on every regeneration, so pinning them here would break
    # the self-test each time weights are refreshed. Exact-value cases live in
    # the embedded string fixtures above.
    if frame_system.is_file():
        kill_prefix = parse_weight_file(frame_system.read_text(encoding="utf-8"))["kill_prefix"]
        assert kill_prefix.ranges == {"p": (0, 1_000)}
        assert set(kill_prefix.slopes) == {"p"} and kill_prefix.slopes["p"][0] > 0
        assert kill_prefix.read_slopes == {"p": 1}
        assert kill_prefix.write_slopes == {"p": 1}
    if pallet_market.is_file():
        buy = parse_weight_file(pallet_market.read_text(encoding="utf-8"))["buy"]
        assert buy.proof_size > 0 and buy.reads > 0 and buy.writes > 0
    if pallet_epoch.is_file():
        tick = parse_weight_file(pallet_epoch.read_text(encoding="utf-8"))["tick"]
        assert tick.ranges == {"n": (1, 10)}
        # The distinct-payload fixture guarantees a per-item preimage read, so
        # tick MUST carry a positive proof-size slope (the B5 undercharge fix).
        assert set(tick.slopes) == {"n"} and tick.slopes["n"][1] > 0
        assert tick.read_slopes.get("n", 0) >= 1 and tick.write_slopes.get("n", 0) >= 1

    head = run_git("rev-parse", "--verify", "HEAD^{commit}").strip()
    main_push = resolve_base(head)
    parents = run_git("rev-list", "--parents", "-n", "1", "HEAD").split()
    if len(parents) > 1:
        assert main_push.notices and "falling back" in main_push.notices[0]
        assert main_push.commit == parents[1]
    else:
        assert main_push.commit is None

    # Counted from this function's own AST rather than typed in. A hand-written
    # count of a hand-written list is the defect SQ-490 spent a whole row on; it
    # would be poor form to leave one here, where it would quietly under-report
    # coverage every time someone adds a case.
    print(f"Weight regression self-tests passed ({_self_test_assertion_count()} assertions).")


def _self_test_assertion_count() -> int:
    import ast

    try:
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    except (OSError, SyntaxError):  # pragma: no cover - defensive
        return 0
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run_self_tests":
            return sum(1 for child in ast.walk(node) if isinstance(child, ast.Assert))
    return 0


def load_weight_sets(base: str) -> tuple[
    dict[str, dict[str, FunctionWeight]],
    dict[str, dict[str, FunctionWeight]],
    int,
]:
    base_paths = base_weight_paths(base)
    head_paths = working_weight_paths()
    base_files = {
        path: parse_weight_file(git_file(base, path))
        for path in sorted(base_paths)
    }
    head_files = {
        path: parse_weight_file((ROOT / path).read_text(encoding="utf-8"))
        for path in sorted(head_paths)
    }
    unparseable_head = [path for path, functions in head_files.items() if not functions]
    unparseable_base = [
        path
        for path in sorted(base_paths & head_paths)
        if not base_files[path]
    ]
    if unparseable_head or unparseable_base:
        details: list[str] = []
        if unparseable_head:
            details.append("working tree: " + ", ".join(unparseable_head))
        if unparseable_base:
            details.append("base: " + ", ".join(unparseable_base))
        raise CheckError(
            "weight file(s) yielded zero parseable functions (gate blind spot): "
            + "; ".join(details)
        )
    return base_files, head_files, len(base_paths | head_paths)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        metavar="REVISION",
        help="base git revision (default: merge-base of HEAD and origin/main)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run embedded parser and regression/removal policy tests",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.self_test:
            run_self_tests()
            return 0
        resolution = resolve_base(args.base)
        for notice in resolution.notices:
            print(f"NOTICE: {notice}")
        if resolution.commit is None:
            print("PASS: no parent commit exists to compare.")
            return 0
        acknowledgements = parse_acknowledgements(ACK_FILE.read_text(encoding="utf-8"))
        base_files, head_files, file_count = load_weight_sets(resolution.commit)
        comparison = compare_weight_sets(base_files, head_files, acknowledgements)
        return 0 if report_comparison(
            comparison, acknowledgements, resolution.commit, file_count
        ) else 1
    except (CheckError, OSError, AssertionError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
