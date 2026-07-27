#!/usr/bin/env python3
"""Regenerate committed weight files, and detect the drift no other gate sees.

`check-weight-regression.py` compares the *committed* file at HEAD against the
*committed* file at the merge base. It therefore detects a regeneration and is
structurally unable to detect the **absence** of one: a pallet can grow storage
for weeks while its committed weights keep describing the old layout, and every
gate stays green. SQ-490 measured that live — `pallet_attestor::remove_for_cause`
had declared 8 reads and actually performed **261**, and `pallet_execution_guard`
was shipping six functions understated by up to 30 %.

This tool closes that hole by re-measuring and comparing per function:

* ``--check`` regenerates into a temporary tree and diffs against the committed
  file. Storage dimensions are the hard gate; ref_time is advisory.
* ``--write`` regenerates the committed files in place.

What is gated hard, and why, was measured rather than assumed — and the first two
generalisations from that measurement were both wrong, so the rule below is stated
with the evidence that survived (SQ-490 item 4):

1. **Compare worst-case totals, never the intercept and slope separately.** The
   generator splits one measured cost between an intercept and a per-component
   slope, and that split is not stable across sampling fidelities even when the
   total is: `pallet_collator_selection::set_candidacy_bond` shifts its proof slope
   901 → 1,306 at low fidelity while its worst-case writes stay at exactly 201.
2. **Constant-weight functions are fidelity-invariant.** `pallet_attestor` (6
   functions, no components) and `pallet_collator_selection` (2 such functions)
   agree exactly between ``--steps 2 --repeat 1`` and ``--steps 50 --repeat 20``.
   Their totals are hard-gated at any fidelity — which is what lets a cheap
   per-commit run catch real staleness, including the original SQ-490 defect
   (`remove_for_cause`, no components, 8 declared reads against 261 performed).
3. **Component-bearing functions are not.** 5 of 9 collator-selection functions
   disagree at 2×1, and `new_session` loses its per-candidate write slope
   *entirely* — worst-case writes 100 at 50×20 against 3 at 2×1. A 2-point fit can
   miss a linear term, and missing it understates, so these are hard-gated only
   when the run's fidelity matches the committed file's header. (`pallet_multisig`
   happens to agree on all 46 of its quantities; agreement is possible, not
   guaranteed, and a gate cannot rest on the lucky case.)
4. **ref_time is advisory always** — 127 % measured spread on unchanged code.

A single failing extrinsic aborts a whole ``--pallet X --extrinsic '*'`` run,
which is how all 39 functions of ``pallet_assets.rs`` stayed frozen at one date
because one upstream fixture is unsatisfiable in this runtime. This tool probes
per extrinsic, regenerates the rest, preserves the unmeasurable ones verbatim,
and **reports** them — a preserved function is never counted as re-measured.

Run:
  python3 tools/ci/regenerate-weights.py --check [--pallet pallet_attestor ...]
  python3 tools/ci/regenerate-weights.py --write --pallet pallet_attestor
  python3 tools/ci/regenerate-weights.py --check --changed [--base origin/main]
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / "runtime" / "bleavit-runtime" / "src" / "weights"
DEFAULT_RUNTIME = (
    ROOT
    / "target"
    / "release"
    / "wbuild"
    / "bleavit-runtime"
    / "bleavit_runtime.compact.compressed.wasm"
)
BENCHER = "frame-omni-bencher"

# The generator records its own fidelity in the file header.
HEADER_FIDELITY_RE = re.compile(r"STEPS:\s*`(\d+)`,\s*REPEAT:\s*`(\d+)`")
# `//! DATE: 2026-07-26, STEPS: ...` — kept for reporting only. Per-function
# comparison is the point; a file date attributes every function to one
# generation event, which is exactly how two hand-appended functions hid inside
# an otherwise-generated `pallet_attestor.rs` (SQ-490).
HEADER_DATE_RE = re.compile(r"DATE:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})")
OUTPUT_LINE_RE = re.compile(r"^// (/.*\.rs)$", re.M)

# A function this tool could not re-measure and copied forward verbatim. The
# marker is canonical and machine-read (`preserved_functions`) so a `--check` run
# reports what the committed file itself admits was never re-measured, instead of
# the reader having to notice a prose comment.
PRESERVED_MARKER = "**Preserved, not re-measured"
PRESERVED_RE = re.compile(
    re.escape(PRESERVED_MARKER) + r".*?\n\tfn ([a-z_][a-z0-9_]*)\s*\(", re.S
)
PRESERVATION = Path(__file__).resolve().parent / "weight-preservation.toml"
PRESERVATION_RE = re.compile(r"^(\S+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S(?:.*\S)?)$")

# Hard-gated always: the block-bounding figures a benchmark records exactly.
BASE_STORAGE_DIMS = ("proof_size", "reads", "writes")


class ToolError(RuntimeError):
    """A user-facing configuration or environment error."""


def load_regression_module():
    """Import `check-weight-regression.py` so exactly one parser exists.

    Two parsers for one file format would be the same artifact-vs-reality split
    this tool exists to detect, so the weight parsing and the worst-case totals
    are reused rather than reimplemented.
    """
    path = Path(__file__).resolve().parent / "check-weight-regression.py"
    spec = importlib.util.spec_from_file_location("check_weight_regression", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ToolError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    # Registered before exec so `@dataclass` can resolve the module's globals.
    sys.modules.setdefault("check_weight_regression", module)
    spec.loader.exec_module(module)
    return module


@dataclass(frozen=True)
class Fidelity:
    steps: int
    repeat: int

    def __str__(self) -> str:
        return f"{self.steps}x{self.repeat}"


#: The fidelity every committed weight artifact must declare, and the only one
#: at which a fitted component slope is trusted (15 §4.5). Pinned here rather
#: than compared header-to-header, because a header the audited file supplies
#: is not evidence about the audited file.
CANONICAL_FIDELITY = Fidelity(50, 20)


@dataclass(frozen=True)
class Drift:
    """One function's disagreement between committed and freshly measured."""

    function: str
    quantity: str
    committed: int
    fresh: int

    def describe(self) -> str:
        delta = ""
        if self.committed:
            delta = f" ({(self.fresh - self.committed) / self.committed * 100:+.1f}%)"
        return (
            f"{self.function}: {self.quantity} {self.committed:,} -> {self.fresh:,}{delta}"
        )


@dataclass
class Comparison:
    pallet: str
    fidelity_matches: bool
    hard: list[Drift] = field(default_factory=list)
    advisory: list[Drift] = field(default_factory=list)
    unmeasured: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    justifications: dict[str, str] = field(default_factory=dict)
    measured: int = 0

    @property
    def failed(self) -> bool:
        # A function the generator no longer emits is a hard failure: either the
        # benchmark was deleted (and the weight must go too) or the committed
        # file carries a hand-appended function that no benchmark measures --
        # literally the SQ-490 defect.
        return bool(self.hard or self.removed)


def parse_fidelity(text: str) -> Fidelity | None:
    match = HEADER_FIDELITY_RE.search(text)
    if not match:
        return None
    return Fidelity(int(match.group(1)), int(match.group(2)))


def parse_date(text: str) -> str | None:
    match = HEADER_DATE_RE.search(text)
    return match.group(1) if match else None


def normalise_output_path(text: str, destination: Path) -> str:
    """Point the header's recorded `--output` at a reproducible path.

    The generator records the absolute path it was told to write, so committed
    files carry whatever temporary directory the author happened to use --
    provenance nobody can reproduce. Rewriting it to the repo-relative
    destination is a header edit only; no measured value is touched.
    """
    try:
        rel = destination.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return text
    return OUTPUT_LINE_RE.sub(f"// {rel}", text, count=1)


def preserved_functions(text: str) -> list[str]:
    """Functions the committed file declares were carried forward, not measured."""
    return sorted({match.group(1) for match in PRESERVED_RE.finditer(last_impl_body(text))})


def load_preservations(path: Path = PRESERVATION) -> dict[tuple[str, str], str]:
    """The declared set of functions allowed to ship without a fresh measurement.

    A marker in the generated file alone must not buy silence: the marker is what
    the tool *writes*, so a self-authorizing marker would let anyone convert "this
    weight is stale" into "this weight is exempt" by adding a comment. Preservation
    is therefore an exemption declared here, justified, and cross-checked against
    the markers in both directions — the same discipline as
    `generated-weight-overrides.toml`, and it expires the same way.
    """
    if not path.is_file():
        return {}
    declared: dict[tuple[str, str], str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = PRESERVATION_RE.match(line)
        if not match:
            raise ToolError(
                f"{path.name}:{number}: expected '<path> <function>: <justification>'"
            )
        rel, function, justification = match.groups()
        key = (rel, function)
        if key in declared:
            raise ToolError(f"{path.name}:{number}: duplicate entry for {rel}::{function}")
        declared[key] = justification
    return declared


def pallet_of(path: Path) -> str:
    return path.stem


def committed_weight_files() -> dict[str, Path]:
    if not WEIGHTS.is_dir():
        return {}
    return {
        pallet_of(path): path
        for path in sorted(WEIGHTS.glob("*.rs"))
        if path.name != "mod.rs"
    }


def source_dirs(pallet: str) -> list[Path]:
    """Local source whose change can invalidate a pallet's measured weights.

    Only Bleavit-custom pallets have local source; an upstream pallet's weights
    move when the SDK pin moves, which `--changed` cannot see from a path diff.
    That limit is reported rather than hidden.
    """
    if not pallet.startswith("pallet_"):
        return []
    stem = pallet.removeprefix("pallet_").replace("_", "-")
    candidates = [ROOT / "pallets" / stem, ROOT / "crates" / f"{stem}-core"]
    return [path for path in candidates if path.is_dir()]


def changed_pallets(base: str) -> tuple[list[str], list[str]]:
    """Pallets whose local source changed against `base`, and the unknowable rest."""
    diff = subprocess.run(
        ["git", "diff", "--name-only", base],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if diff.returncode != 0:
        raise ToolError(f"git diff against {base!r} failed: {diff.stderr.strip()}")
    touched = [line for line in diff.stdout.splitlines() if line]
    selected: list[str] = []
    unknowable: list[str] = []
    for pallet in committed_weight_files():
        dirs = source_dirs(pallet)
        if not dirs:
            unknowable.append(pallet)
            continue
        prefixes = tuple(f"{d.relative_to(ROOT).as_posix()}/" for d in dirs)
        if any(path.startswith(prefixes) for path in touched):
            selected.append(pallet)
    return selected, unknowable


def list_extrinsics(runtime: Path) -> dict[str, list[str]]:
    """Every (pallet, extrinsic) the runtime actually declares a benchmark for.

    This, not the committed file, is the authoritative work list. Deriving it from
    the committed file would make the tool blind in both directions: a benchmark
    added since the last generation would never be named in a selective rerun (so
    it would silently stay unmeasured), and a function hand-appended to a
    generated file with no benchmark behind it would look like something to
    preserve rather than the defect it is. Taking the list from the runtime turns
    both into reported differences.
    """
    result = subprocess.run(
        [BENCHER, "v1", "benchmark", "pallet", "--runtime", str(runtime), "--list"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()
        raise ToolError(
            "could not list the runtime's benchmarks "
            f"({tail[-1] if tail else f'exit {result.returncode}'}). Is the runtime built with "
            "--features runtime-benchmarks?"
        )
    listed: dict[str, list[str]] = {}
    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 2 or parts == ["pallet", "extrinsic"] or not parts[0]:
            continue
        listed.setdefault(parts[0], []).append(parts[1])
    if not listed:
        raise ToolError("the runtime reported no benchmarks at all")
    return listed


def run_bencher(
    runtime: Path,
    pallet: str,
    extrinsics: list[str],
    output: Path,
    fidelity: Fidelity,
) -> tuple[bool, str]:
    command = [
        BENCHER,
        "v1",
        "benchmark",
        "pallet",
        "--runtime",
        str(runtime),
        "--pallet",
        pallet,
        "--extrinsic",
        ",".join(extrinsics),
        "--steps",
        str(fidelity.steps),
        "--repeat",
        str(fidelity.repeat),
        "--output",
        str(output),
        "--unsafe-overwrite-results",
    ]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode == 0 and output.is_file():
        return True, ""
    tail = (result.stderr or result.stdout or "").strip().splitlines()
    return False, tail[-1] if tail else f"exit {result.returncode}"


@dataclass
class Regeneration:
    text: str
    preserved: list[str] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)


def last_impl_body(text: str) -> str:
    """The final `WeightInfo` impl block, which is the one the runtime binds.

    `check-weight-regression.py` keeps the last impl per file, so anything that
    reads a function's committed source must scope to the same block or it can
    copy a shadowed definition from an earlier one.
    """
    matches = list(re.finditer(r"impl[^{]*WeightInfo[^{]*\{", text))
    return text[matches[-1].end() :] if matches else text


def extract_function_block(text: str, function: str) -> str | None:
    """The committed source of one weight function, with its doc comments."""
    text = last_impl_body(text)
    match = re.search(rf"\n\tfn {re.escape(function)}\s*\(", text)
    if not match:
        return None
    start = match.start() + 1
    # Walk back over the contiguous `///` block that documents it. `text[:start]`
    # stops at the function's own indentation, so every line here is prefix.
    lines = text[:start].splitlines(keepends=True)
    prefix: list[str] = []
    for line in reversed(lines):
        if line.lstrip().startswith("///"):
            prefix.insert(0, line)
            continue
        break
    end = text.find("\n\t}\n", match.start())
    if end == -1:
        return None
    return "".join(prefix) + text[start : end + len("\n\t}\n")]


def load_purity_overrides() -> dict[tuple[str, str], str]:
    """Functions `check-generated-weights.py` allows to be hand-written.

    These must survive a regeneration. Two of them are `pallet_xcm`'s
    protocol-disabled calls holding a fail-closed `Weight::MAX` (09 §6.2); a
    regeneration would replace those sentinels with a real measured value, quietly
    turning "no fixture may bypass the filters" into an ordinary weight. The purity
    gate would then fail on the stale override, so the mistake is catchable — but a
    tool should not need another gate to catch it corrupting a file.
    """
    path = Path(__file__).resolve().parent / "check-generated-weights.py"
    spec = importlib.util.spec_from_file_location("check_generated_weights", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ToolError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("check_generated_weights", module)
    spec.loader.exec_module(module)
    return module.load_overrides()


def substitute_preserved(
    fresh: str, committed: str, functions: list[str], reason: str
) -> str:
    """Force the committed body of each named function into fresh output.

    Unlike `splice_preserved`, this replaces a definition the generator *did*
    emit — needed for a hand-written weight that must not be re-measured, where
    appending would produce a duplicate function and fail to compile.
    """
    for function in functions:
        block = extract_function_block(committed, function)
        if block is None:
            raise ToolError(f"cannot preserve {function}: not found in the committed file")
        marked = f"\t/// **Preserved, not re-measured:** {reason}\n{block}"
        emitted = extract_function_block(fresh, function)
        if emitted is None:
            fresh = splice_preserved(fresh, committed, [function], reason)
        else:
            fresh = fresh.replace(emitted, marked, 1)
    return fresh


def splice_preserved(fresh: str, committed: str, functions: list[str], reason: str) -> str:
    """Re-insert functions the generator could not measure, verbatim.

    Copying a previously generated function keeps the generator's own grammar
    (so `check-generated-weights.py` still sees a measured function) and keeps
    the runtime compiling, which naming the passing extrinsics alone would not.
    The alternative is what happened before: one broken fixture discards 38 good
    measurements.
    """
    closing = fresh.rstrip().rfind("\n}")
    if closing == -1:
        raise ToolError("regenerated file has no closing impl brace")
    blocks = []
    for function in functions:
        block = extract_function_block(committed, function)
        if block is None:
            raise ToolError(f"cannot preserve {function}: not found in the committed file")
        blocks.append(f"\t/// **Preserved, not re-measured:** {reason}\n{block}")
    return fresh[:closing] + "\n" + "".join(blocks) + fresh[closing + 1 :]


def _preserved_regeneration(
    output: Path,
    destination: Path,
    committed: str,
    failures: dict[str, str],
    measured: int,
) -> Regeneration:
    """Assemble a regeneration that carried some functions forward unmeasured."""
    text = normalise_output_path(output.read_text(encoding="utf-8"), destination)
    preserved = sorted(failures)
    reason = (
        f"its benchmark fixture is unsatisfiable in this runtime ({failures[preserved[0]]}); "
        f"the other {measured} function(s) in this file are freshly measured."
    )
    return Regeneration(
        text=splice_preserved(text, committed, preserved, reason),
        preserved=preserved,
        failures=failures,
    )


def regenerate_pallet(
    runtime: Path,
    pallet: str,
    committed: str,
    destination: Path,
    fidelity: Fidelity,
    workdir: Path,
    known: list[str],
    allowed: set[str],
    hand_written: set[str],
) -> Regeneration:
    output = workdir / f"{pallet}.rs"
    ok, error = run_bencher(runtime, pallet, ["*"], output, fidelity)
    if ok:
        text = normalise_output_path(output.read_text(), destination)
        if hand_written:
            text = substitute_preserved(
                text,
                committed,
                sorted(hand_written),
                "a deliberate hand-written weight declared in "
                "tools/ci/generated-weight-overrides.toml; regeneration must not replace it",
            )
        return Regeneration(text=text, preserved=sorted(hand_written))

    # One extrinsic aborted the pallet. Find which, keep the rest. The work list
    # comes from the runtime, never the committed file — see `list_extrinsics`.
    # Probing only needs pass/fail, so it runs at the cheapest fidelity.
    if not known:
        raise ToolError(
            f"{pallet}: benchmarking failed ({error}) and the runtime lists no extrinsics "
            "for it"
        )
    probe_fidelity = Fidelity(2, 1)

    def probe(function: str) -> tuple[bool, str]:
        target = workdir / f"probe_{pallet}_{function}.rs"
        return run_bencher(runtime, pallet, [function], target, probe_fidelity)

    # Fast path. The committed file already names what could not be measured last
    # time, so re-confirm just those instead of probing every extrinsic — 2 runs
    # rather than 39 for `pallet_assets`. Each is still checked individually, so a
    # fixture that has become runnable is caught rather than assumed broken, and
    # `known` comes from the runtime so a benchmark added since the last generation
    # is still named in the rerun.
    declared = [function for function in preserved_functions(committed) if function in known]
    failures: dict[str, str] = {}
    if declared:
        for function in declared:
            good, probe_error = probe(function)
            if not good:
                failures[function] = probe_error
        if failures:
            candidate = [function for function in known if function not in failures]
            ok, _ = run_bencher(runtime, pallet, candidate, output, fidelity)
            if ok:
                return _preserved_regeneration(
                    output, destination, committed, failures, len(candidate)
                )
        failures = {}

    passing: list[str] = []
    for function in known:
        good, probe_error = probe(function)
        if good:
            passing.append(function)
        else:
            failures[function] = probe_error
    if not passing:
        raise ToolError(f"{pallet}: every extrinsic failed to benchmark ({error})")
    undeclared = sorted(set(failures) - allowed - hand_written)
    if undeclared:
        # Refuse to invent the exemption. Preserving these would silently drop them
        # out of the freshness gate, which is the outcome a declared, justified
        # entry exists to make someone actually decide.
        raise ToolError(
            f"{pallet}: {', '.join(undeclared)} cannot be benchmarked "
            f"({failures[undeclared[0]]}) and are not declared in {PRESERVATION.name}. Fix the "
            "fixture, or add a justified entry saying why shipping an unverified weight for it "
            "is acceptable."
        )
    ok, error = run_bencher(runtime, pallet, passing, output, fidelity)
    if not ok:
        raise ToolError(f"{pallet}: regeneration failed after excluding failures ({error})")
    regenerated = _preserved_regeneration(
        output, destination, committed, failures, len(passing)
    )
    still_hand_written = sorted(hand_written - set(failures))
    if still_hand_written:
        regenerated.text = substitute_preserved(
            regenerated.text,
            committed,
            still_hand_written,
            "a deliberate hand-written weight declared in "
            "tools/ci/generated-weight-overrides.toml; regeneration must not replace it",
        )
        regenerated.preserved = sorted(set(regenerated.preserved) | hand_written)
    return regenerated


def compare_pallet(
    pallet: str,
    committed: str,
    fresh: str,
    preserved: list[str],
    parse_weight_file,
) -> Comparison:
    old = parse_weight_file(committed) if committed else {}
    new = parse_weight_file(fresh)
    old_fidelity = parse_fidelity(committed)
    new_fidelity = parse_fidelity(fresh)
    # Fidelity is judged against the pinned canonical value, NOT against the
    # committed file's own header. Text-equality against the artifact under
    # audit is a one-character gate bypass: nothing anywhere pinned the header,
    # so changing `REPEAT: 20` to `21` in the committed file made *this run's*
    # fidelity "match" without a single benchmark executing, demoting every
    # component-bearing function to advisory — including inside the
    # release-blocking `Component weights at committed fidelity` job that
    # `publish` depends on.
    matches = bool(
        new_fidelity == CANONICAL_FIDELITY and old_fidelity == CANONICAL_FIDELITY
    )
    comparison = Comparison(pallet=pallet, fidelity_matches=matches)
    if committed and old_fidelity != CANONICAL_FIDELITY:
        # Hard, not advisory: a committed artifact that does not declare the
        # canonical fidelity was either generated at a fidelity whose fitted
        # slopes were never verified, or had its header edited.
        comparison.hard.append(
            Drift(
                "<header>",
                "committed_fidelity",
                str(CANONICAL_FIDELITY),
                str(old_fidelity),
            )
        )

    for function in sorted(set(old) | set(new)):
        if function in preserved:
            comparison.unmeasured.append(function)
            continue
        if function not in old:
            comparison.added.append(function)
            continue
        if function not in new:
            comparison.removed.append(function)
            continue
        comparison.measured += 1
        before, after = old[function], new[function]

        # Component ranges come from the benchmark definition, not from a fit, so
        # they are exact at every fidelity and always hard.
        for component in sorted(set(before.ranges) | set(after.ranges)):
            lo = before.ranges.get(component, (0, 0))[1]
            hi = after.ranges.get(component, (0, 0))[1]
            if lo != hi:
                comparison.hard.append(Drift(function, f"range.{component}.high", lo, hi))

        # Compare **worst-case totals**, not the intercept and slope separately.
        # The generator splits one measured cost between an intercept and a
        # per-component slope, and that split is not stable across sampling
        # fidelities even when the total is: `pallet_collator_selection::
        # set_candidacy_bond` moves its proof slope 901 -> 1,306 at 2x1 while its
        # worst-case total stays at exactly 201 writes. Gating the decomposition
        # would therefore fire on arithmetic that means nothing.
        try:
            lhs_totals = before.worst_case_totals()
            rhs_totals = after.worst_case_totals()
        except Exception as error:  # a slope with no generated range
            raise ToolError(f"{pallet}::{function}: cannot evaluate worst case ({error})")

        # Whether a *total* is trustworthy at reduced fidelity depends on whether
        # the function has a fitted component at all, and this was measured rather
        # than assumed — twice, because the first generalisation was wrong.
        # Constant-weight functions agree exactly across fidelities (`pallet_attestor`
        # 6/6, `pallet_collator_selection` 2/2). Component-bearing ones do not:
        # 5 of 9 collator-selection functions differ at 2x1, and
        # `new_session` loses its per-candidate write slope *entirely* — worst-case
        # writes 100 at 50x20 against 3 at 2x1. A 2-point fit can miss a linear
        # term, which is exactly the direction that would mask an understatement,
        # so component functions are hard-gated only at matching fidelity.
        # Derived from the **fresh** regeneration only. `before` is the file
        # under audit, and `before.ranges` is populated exclusively from free
        # text — a `///` line the generator writes and nothing structurally
        # verifies. Reading it here let a PR declare a degenerate `[0, 0]`
        # range on a constant-weight function and thereby demote that
        # function's storage comparison from HARD to ADVISORY: `[0, 0]` also
        # slips the range cross-check above (lo == hi == 0) and contributes
        # `slope x high = 0` to the totals, so nothing else notices. That is
        # the literal SQ-490 shape — an understated read count — with the gate
        # that exists to catch it disabled by one comment line inside the
        # artifact it is checking.
        #
        # `after` is this tool's own output, so it cannot be forged by a diff.
        # The legitimate "committed had a component, the fresh run lost it"
        # case is already a hard failure via the range cross-check above.
        has_components = bool(after.ranges)
        bucket = (
            comparison.hard
            if (matches or not has_components)
            else comparison.advisory
        )
        for dim in BASE_STORAGE_DIMS:
            key = f"worst_case.{dim}"
            if lhs_totals[key] != rhs_totals[key]:
                bucket.append(
                    Drift(function, f"worst_case.{dim}", lhs_totals[key], rhs_totals[key])
                )

        # ref_time is always advisory: the measured jitter on unchanged code
        # reaches 127 %, so a percentage on it is not a defect signal.
        if before.ref_time != after.ref_time:
            comparison.advisory.append(
                Drift(function, "base.ref_time", before.ref_time, after.ref_time)
            )
    return comparison


def report(comparison: Comparison) -> None:
    fidelity_note = "" if comparison.fidelity_matches else " (fidelity differs)"
    print(f"  {comparison.pallet}: {comparison.measured} function(s) re-measured{fidelity_note}")
    for drift in comparison.hard:
        print(f"    STALE  {drift.describe()}")
    for function in comparison.removed:
        print(
            f"    STALE  {function}: committed but no benchmark emits it — a "
            "hand-appended weight, or a deleted benchmark"
        )
    for drift in comparison.advisory:
        print(f"    note   {drift.describe()}")
    for function in comparison.unmeasured:
        # Restated in full every run: this is the one weight the gate is not
        # checking for anybody, so its justification should be read, not filed.
        print(f"    UNVERIFIED  {function}: preserved, NOT re-measured")
        if function in comparison.justifications:
            print(f"                {comparison.justifications[function]}")
    for function in comparison.added:
        print(f"    note   {function}: newly benchmarked, no committed value")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="compare without writing")
    mode.add_argument("--write", action="store_true", help="regenerate in place")
    parser.add_argument("--pallet", action="append", default=[], help="repeatable")
    parser.add_argument(
        "--changed", action="store_true", help="select pallets whose local source changed"
    )
    parser.add_argument(
        "--components-only",
        action="store_true",
        help="select only pallets containing a component-bearing function — the set a "
        "reduced-fidelity run cannot gate, and therefore the release-time obligation",
    )
    parser.add_argument("--base", default="origin/main", help="base for --changed")
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--repeat", type=int, default=20)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        return _run(parse_args(argv))
    except ToolError as error:
        # Notably `--changed` against a base the checkout does not have: CI's
        # shallow clone has no `origin/main`, the trap that shipped a red weight
        # job once already. Fail closed with a readable message, never a traceback.
        print(f"regenerate-weights: {error}", file=sys.stderr)
        return 2


def _run(args: argparse.Namespace) -> int:
    # A full run re-measures every pallet and takes many minutes. Block-buffered
    # stdout would show nothing at all until it finished, in CI logs included.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    regression = load_regression_module()
    parse_weight_file = regression.parse_weight_file

    files = committed_weight_files()
    if args.pallet:
        unknown = [p for p in args.pallet if p not in files]
        if unknown:
            print(
                f"regenerate-weights: no committed weight file for {', '.join(unknown)}",
                file=sys.stderr,
            )
            return 2
        selected = list(args.pallet)
    elif args.components_only:
        # Derived from the committed files, not listed by hand: a pallet needs a
        # matching-fidelity run exactly when it has a fitted component, because
        # that is the only case a cheap run cannot gate (a 2-point fit can lose a
        # linear term, and losing it understates).
        selected = [
            pallet
            for pallet, path in files.items()
            if any(
                weight.ranges
                for weight in parse_weight_file(path.read_text(encoding="utf-8")).values()
            )
        ]
        print(
            f"Component-bearing pallets ({len(selected)} of {len(files)}): "
            + ", ".join(selected)
        )
        if not selected:
            print("no component-bearing weight function in the repository.")
            return 0
    elif args.changed:
        selected, unknowable = changed_pallets(args.base)
        if unknowable:
            print(
                f"note: {len(unknowable)} upstream weight file(s) have no local source, so "
                "--changed cannot see their drift; they move with the SDK pin. Run without "
                "--changed to cover them."
            )
        if not selected:
            print("no pallet with local source changed; nothing to re-measure.")
            return 0
    else:
        selected = list(files)

    if not args.runtime.is_file():
        print(
            f"regenerate-weights: {args.runtime} is missing. Build it with:\n"
            "  cargo build -p bleavit-runtime --release --features runtime-benchmarks --locked",
            file=sys.stderr,
        )
        return 2

    fidelity = Fidelity(args.steps, args.repeat)
    print(
        f"Re-measuring {len(selected)} pallet(s) at {fidelity} against "
        f"{args.runtime.relative_to(ROOT) if args.runtime.is_relative_to(ROOT) else args.runtime}"
    )

    # Freshness exemptions, cross-checked against the markers before any
    # measurement runs, so neither side can drift. A function may be exempt for
    # either of two declared reasons — its fixture cannot run
    # (weight-preservation.toml) or its weight is deliberately hand-written
    # (generated-weight-overrides.toml) — and `--write` marks both, so the check
    # accepts either declaration. Consulting only the first would fail the gate on
    # a hand-written weight that this tool itself just preserved correctly.
    purity_overrides = load_purity_overrides()
    preservations = load_preservations()
    declared_exempt = {**purity_overrides, **preservations}
    marked: dict[tuple[str, str], None] = {}
    for pallet, path in files.items():
        rel = path.relative_to(ROOT).as_posix()
        for function in preserved_functions(path.read_text(encoding="utf-8")):
            marked[(rel, function)] = None
    undeclared = sorted(set(marked) - set(declared_exempt))
    unmarked = sorted(set(preservations) - set(marked))
    if undeclared:
        print(
            "regenerate-weights: these functions are marked preserved but are declared in "
            f"neither {PRESERVATION.name} nor generated-weight-overrides.toml, so they would be "
            "exempt from the freshness gate with no justification: "
            + ", ".join(f"{rel}::{fn}" for rel, fn in undeclared),
            file=sys.stderr,
        )
        return 1
    if unmarked:
        print(
            f"regenerate-weights: stale {PRESERVATION.name} entries — no such preserved "
            "function: " + ", ".join(f"{rel}::{fn}" for rel, fn in unmarked),
            file=sys.stderr,
        )
        return 1

    listed = list_extrinsics(args.runtime)
    # A committed weight file with no benchmarks behind it, or a benchmarked pallet
    # with no committed weights, is a coverage gap in itself — neither can be
    # detected by comparing values, so assert the two sets agree.
    orphans = sorted(set(files) - set(listed))
    unweighted = sorted(set(listed) - set(files))
    if orphans:
        print(
            f"regenerate-weights: {', '.join(orphans)} have committed weight files but the "
            "runtime declares no benchmarks for them",
            file=sys.stderr,
        )
        return 1
    if unweighted:
        print(
            f"regenerate-weights: {', '.join(unweighted)} are benchmarked but have no committed "
            "weight file, so nothing gates their weights",
            file=sys.stderr,
        )
        return 1

    failed: list[Comparison] = []
    recovered: list[str] = []
    with tempfile.TemporaryDirectory() as raw:
        workdir = Path(raw)
        for index, pallet in enumerate(selected, 1):
            print(f"[{index}/{len(selected)}] {pallet}")
            destination = files[pallet]
            committed = destination.read_text(encoding="utf-8")
            try:
                regenerated = regenerate_pallet(
                    args.runtime,
                    pallet,
                    committed,
                    destination,
                    fidelity,
                    workdir,
                    sorted(listed[pallet]),
                    {
                        function
                        for (rel, function) in preservations
                        if rel == destination.relative_to(ROOT).as_posix()
                    },
                    {
                        function
                        for (rel, function) in purity_overrides
                        if rel == destination.relative_to(ROOT).as_posix()
                    },
                )
            except ToolError as error:
                print(f"  {pallet}: FAILED — {error}", file=sys.stderr)
                return 2
            comparison = compare_pallet(
                pallet, committed, regenerated.text, regenerated.preserved, parse_weight_file
            )
            # A function may be unverified for either reason: its fixture cannot
            # run (weight-preservation.toml) or its weight is deliberately
            # hand-written (generated-weight-overrides.toml). Both justify, so both
            # are consulted — an unverified function with no reason printed would be
            # the one case a reader could not evaluate.
            rel = destination.relative_to(ROOT).as_posix()
            reasons = {**purity_overrides, **preservations}
            comparison.justifications = {
                function: reasons[(rel, function)]
                for function in comparison.unmeasured
                if (rel, function) in reasons
            }
            report(comparison)
            # A previously unmeasurable fixture that now runs must FAIL, not
            # merely print. The declaration/marker cross-check above runs against
            # the *committed* text, so it cannot see this transition — and if this
            # were only a note, the exemption would never expire: the entry would
            # sit there indefinitely, ready to carry a *later* genuine failure
            # forward unnoticed. An exemption that cannot expire is not the
            # mechanically expiring control this gate claims to be.
            for function in preserved_functions(committed):
                if function not in regenerated.preserved:
                    print(
                        f"    RUNNABLE  {function}: was preserved, now benchmarks cleanly",
                        file=sys.stderr,
                    )
                    recovered.append(f"{pallet}::{function}")
            if comparison.failed:
                failed.append(comparison)
            if args.write:
                destination.write_text(regenerated.text, encoding="utf-8")
                print(f"    wrote {destination.relative_to(ROOT)}")

    if recovered:
        print(
            f"\nFAIL: {len(recovered)} preserved fixture(s) now benchmark cleanly: "
            + ", ".join(recovered)
            + f".\nThis is good news and it is still a failure: remove the "
            f"`{PRESERVED_MARKER}` doc comment and the matching {PRESERVATION.name} entry "
            "so the function rejoins the freshness gate. Leaving the exemption in place "
            "would let a later, genuine benchmark failure be carried forward unnoticed.",
            file=sys.stderr,
        )
        return 1
    if failed and args.write:
        # Drift is the expected input to `--write`, and it has just been corrected
        # on disk. Reporting a failure here would make the fix look like a break.
        print(
            f"\nUPDATED: {len(failed)} pallet(s) had stale storage dimensions; the "
            "regenerated values are now committed to the working tree. Review the diff."
        )
        return 0
    if failed:
        print(
            "\nFAIL: committed weights disagree with a fresh measurement for "
            f"{len(failed)} pallet(s). These are the block-bounding dimensions, which "
            "are exact — not jitter. Regenerate with:\n"
            "  python3 tools/ci/regenerate-weights.py --write --pallet "
            + " --pallet ".join(c.pallet for c in failed),
            file=sys.stderr,
        )
        return 1
    print("\nPASS: committed storage dimensions match a fresh measurement.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
