#!/usr/bin/env python3
"""Export ``bleavit.sim-calibration.v1`` from the S4 Phase-0 calibration artifact.

The G0 exit gate (``tools/phase-gates/check-phase0-exit.py``) consumes the
S4-owned ``bleavit.sim-calibration.v1`` evidence fail-closed.  This producer is
the only sanctioned bridge from ``simulation/results/phase0-calibration.json``
to that consumer schema, and it refuses to produce evidence unless the S4
artifact is fully green:

- the working tree must be clean (evidence binds ``git_commit`` to HEAD;
  the B7 ``run-evidence.py`` / G0 checker model),
- ``tools/simulation/run-calibration.py --check`` must exit 0 (structural
  verification, byte-exact pinned subsample, Merkle root, and **no recorded
  economic violations**),
- the artifact's own publication gates must all hold (``designation ==
  "published"``, every eligibility flag true, empty violation list), and
- every per-class decidable-harm false-pass rate must be strictly < 1 %
  (15 §4.9; the consumer re-checks, this producer refuses earlier).

Classes map ``treasury`` -> ``trs`` (the doc-13 suffix vocabulary).  Values
recorded as strings in the S4 artifact are exported as JSON numbers.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Mapping

SCHEMA = "bleavit.sim-calibration.v1"
DEFAULT_ARTIFACT = Path("simulation/results/phase0-calibration.json")
CLASS_MAP = {"param": "param", "treasury": "trs", "code": "code", "meta": "meta"}
FALSE_PASS_LIMIT = 0.01

Runner = Callable[[list[str]], subprocess.CompletedProcess]


class ExportError(RuntimeError):
    """Raised whenever the artifact is not eligible for export (fail closed)."""


def run_command(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def git_head(root: Path, runner: Runner) -> str:
    result = runner(["git", "-C", str(root), "rev-parse", "HEAD"])
    if result.returncode != 0:
        raise ExportError(f"cannot resolve HEAD: {result.stderr.strip()}")
    head = result.stdout.strip()
    if len(head) != 40:
        raise ExportError(f"unexpected HEAD format: {head!r}")
    return head


def require_clean_tree(root: Path, runner: Runner, out_path: Path) -> None:
    result = runner(["git", "-C", str(root), "status", "--porcelain"])
    if result.returncode != 0:
        raise ExportError(f"cannot read git status: {result.stderr.strip()}")
    dirty = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip().strip('"')
        try:
            absolute = (root / path).resolve()
        except OSError:
            absolute = root / path
        if absolute == out_path.resolve():
            continue
        dirty.append(path)
    if dirty:
        raise ExportError(
            "working tree is dirty; evidence must bind to committed bytes: "
            + ", ".join(sorted(dirty)[:10])
        )


def require_green_check(root: Path, runner: Runner) -> None:
    result = runner(
        [sys.executable, str(root / "tools" / "simulation" / "run-calibration.py"), "--check"]
    )
    if result.returncode != 0:
        raise ExportError(
            "run-calibration.py --check is red (structure, subsample, Merkle, or "
            "recorded economic violations); refusing to export. Last output: "
            + (result.stdout + result.stderr).strip()[-400:]
        )


def as_number(value: Any, label: str) -> float | int:
    if isinstance(value, bool):
        raise ExportError(f"{label} must be a number, got a bool")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    if isinstance(value, str):
        text = value.strip()
        try:
            if any(ch in text for ch in ".eE"):
                return float(text)
            return int(text)
        except ValueError as error:
            raise ExportError(f"{label} is not numeric: {value!r}") from error
    raise ExportError(f"{label} must be a number or numeric string, got {type(value).__name__}")


def require_eligible(document: Mapping[str, Any]) -> None:
    violations = document.get("violations")
    if violations != []:
        raise ExportError(
            f"artifact records {len(violations) if isinstance(violations, list) else '?'} "
            "economic violation(s); refusing to export"
        )
    published = document.get("published")
    if not isinstance(published, Mapping):
        raise ExportError("artifact has no published block")
    if published.get("designation") != "published":
        raise ExportError(
            "publication designation is "
            f"{published.get('designation')!r}, not 'published'; refusing to export"
        )
    eligibility = published.get("eligibility")
    if not isinstance(eligibility, Mapping):
        raise ExportError("published.eligibility missing")
    if eligibility.get("all_decidable_harm_false_pass_lt_1pct") is not True:
        raise ExportError("eligibility.all_decidable_harm_false_pass_lt_1pct is not true")
    if eligibility.get("sub_3p_brackets_clean") is not True:
        raise ExportError("eligibility.sub_3p_brackets_clean is not true")
    by_class = eligibility.get("by_class")
    if not isinstance(by_class, Mapping) or set(by_class) != set(CLASS_MAP):
        raise ExportError("eligibility.by_class must cover param/treasury/code/meta")
    for name, flag in by_class.items():
        if flag is not True:
            raise ExportError(f"eligibility.by_class.{name} is not true")


def false_pass_rates(document: Mapping[str, Any]) -> dict[str, float]:
    metrics = document.get("metrics")
    if not isinstance(metrics, Mapping) or set(metrics) != set(CLASS_MAP):
        raise ExportError("metrics must cover exactly param/treasury/code/meta")
    rates: dict[str, float] = {}
    for source, target in CLASS_MAP.items():
        block = metrics.get(source)
        if not isinstance(block, Mapping):
            raise ExportError(f"metrics.{source} must be an object")
        value = as_number(
            block.get("decidable_harm_false_pass_rate"),
            f"metrics.{source}.decidable_harm_false_pass_rate",
        )
        rate = float(value)
        if not 0.0 <= rate <= 1.0:
            raise ExportError(f"metrics.{source} rate {rate} outside [0, 1]")
        if rate >= FALSE_PASS_LIMIT:
            raise ExportError(
                f"metrics.{source} decidable-harm false-pass rate {rate} is not "
                f"strictly < {FALSE_PASS_LIMIT}; refusing to export"
            )
        rates[target] = rate
    return rates


def calibration_map(document: Mapping[str, Any]) -> dict[str, float | int]:
    published = document["published"]
    values = published.get("values")
    candidates = published.get("candidates")
    source = values if isinstance(values, Mapping) else candidates
    if not isinstance(source, Mapping):
        raise ExportError("published block carries neither values nor candidates")
    floors = published.get("tested_floor_inputs")
    if not isinstance(floors, Mapping):
        raise ExportError("published.tested_floor_inputs missing")
    deltas = floors.get("dec.delta")
    if not isinstance(deltas, Mapping) or set(deltas) != set(CLASS_MAP):
        raise ExportError("tested_floor_inputs['dec.delta'] must cover the four classes")

    calibration: dict[str, float | int] = {}
    for source_name, target in CLASS_MAP.items():
        calibration[f"dec.delta.{target}"] = as_number(
            deltas[source_name], f"dec.delta.{source_name}"
        )
    calibration["pol.b_baseline"] = as_number(
        floors.get("pol.b_baseline"), "pol.b_baseline"
    )
    for key in ("sec.prize.param", "sec.prize.code", "sec.prize.meta", "sec.flow_cap"):
        if key not in source:
            raise ExportError(f"published values are missing {key}")
        calibration[key] = as_number(source[key], key)
    for key, value in calibration.items():
        if float(value) < 0:
            raise ExportError(f"calibration {key} is negative: {value}")
    return calibration


def build_evidence(document: Mapping[str, Any], head: str) -> dict[str, Any]:
    require_eligible(document)
    proposals = document.get("proposal_count")
    if not isinstance(proposals, int) or isinstance(proposals, bool) or proposals < 10_000:
        raise ExportError("proposal_count must be an integer >= 10000")
    outcome_root = document.get("outcome_digest_root")
    if not isinstance(outcome_root, str) or not outcome_root:
        raise ExportError("outcome_digest_root missing")
    return {
        "schema": SCHEMA,
        "git_commit": head,
        "synthetic_proposals": proposals,
        "false_pass_rate": false_pass_rates(document),
        "attack_cost_validation": {
            "validated": True,
            "method": (
                "executed-trade-ledger simulation (15 §4.9): bracketed flip "
                "thresholds vs 3·InCapPrize across the doc-14 manipulator "
                "strategies; sub-3P brackets clean per the artifact's "
                "publication gates"
            ),
            "artifact_outcome_digest_root": outcome_root,
        },
        "calibration": calibration_map(document),
    }


def main(argv: list[str] | None = None, runner: Runner = run_command) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--artifact", type=Path, default=DEFAULT_ARTIFACT,
        help="S4 calibration artifact (default: %(default)s)",
    )
    parser.add_argument("--out", type=Path, required=True, help="output evidence path")
    parser.add_argument(
        "--skip-check", action="store_true",
        help="skip the run-calibration.py --check leg (tests only; the real "
        "export must run it)",
    )
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent.parent.parent

    try:
        head = git_head(root, runner)
        require_clean_tree(root, runner, args.out)
        if not args.skip_check:
            require_green_check(root, runner)
        try:
            document = json.loads(args.artifact.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ExportError(f"cannot load artifact {args.artifact}: {error}") from error
        if not isinstance(document, dict):
            raise ExportError("artifact top level must be an object")
        evidence = build_evidence(document, head)
    except ExportError as error:
        print(f"export-sim-calibration: REFUSED: {error}", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        f"export-sim-calibration: wrote {args.out} "
        f"({evidence['synthetic_proposals']} proposals, "
        f"{len(evidence['calibration'])} calibration keys, HEAD {head[:12]})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
