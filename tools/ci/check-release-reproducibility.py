#!/usr/bin/env python3
"""Two independent CI environments produced the same release — 12 §1.1, INV-FE-10 (F13).

12 §1.1: *"Two independent CI environments MUST produce an identical tree hash."*
15 §4.8 carries the same row as a release gate ("two independent environments
byte-identical"), and INV-FE-10 is the invariant behind both.

Both `release:build` runs already happened — `ci.yml`'s `app` job and its
`desktop-shell` job — on independent runners. Nothing compared them, because neither
published anything a comparison could read. `app/tools/release/repro-manifest.ts` is
now the producer; this is the consumer.

## Why this is Python and the producer is TypeScript

The comparison needs two JSON files and nothing else — no Node, no pnpm, no install,
no build — so the job that runs it costs seconds rather than minutes. It also puts the
tree-digest convention in **two implementations that must agree**, which is the same
shape `crates/embedded-tree` and `app/tests/platform` already use for the startup
assertion: the digest each manifest declares is *recomputed here from its own file
map*, so a producer that miscomputed or hand-edited one would be caught by the
consumer rather than agreed with. `app/fixtures/tree-digest-cases.json` is read in
place by this module's tests and by `app/tests/release/repro-manifest.test.ts`, so the
two implementations cannot drift apart quietly.

## What it refuses, and the refusals that are not about the files

A gate that only compared the file maps would pass in four situations where it has
proved nothing:

  1. **The same environment twice.** "Two environments" that share every recorded axis
     is one environment run twice — a repeatability check, not a reproducibility one,
     and indistinguishable from the real thing in a green log. So at least one
     *substantive* axis must genuinely differ, and the incidental facts (hostname,
     runner name) are held where they cannot satisfy that.
  2. **Two different commits.** Two trees built from different sources agreeing is a
     surprise; disagreeing proves nothing at all. Equal source commits and equal
     build-recipe digests are preconditions of the comparison, not part of it.
  3. **A self-consistent lie.** A manifest whose declared tree digest does not describe
     its own file map is not evidence about a build; it is evidence about a producer.
  4. **Two different recipes, one variable at a time** (SQ-1009). 12 §1.1 lists
     `SOURCE_DATE_EPOCH` in the deterministic-build recipe beside the Node pin and the
     frozen lockfile, so the two environments must carry the *same* one. That makes it a
     **recipe axis** rather than an environment axis, and the classification does two
     things `RECIPE_AXES` below implements: it must be equal, and it can never satisfy
     refusal 1 — an axis the recipe fixes cannot demonstrate that two environments were
     independent.

     The refusal has to name the *recipe*, not the bytes. Without it a legitimate recipe
     violation arrives disguised as a file-level diff, and the cheapest way to make that
     diff go away is to unset the variable — which is the failure the whole convention
     exists to prevent, arriving through the gate meant to catch it. For the same reason
     an absent value is refused rather than read as "not observable here": two `null`s
     compare equal, so unsetting it on both sides would otherwise buy silence.

When it does fail on the files, it names **every** differing path with both digests.
A reproducibility gate that reports only "not identical" leaves the person who has to
fix it with a whole tree to bisect.

## What none of this proves

Setting `SOURCE_DATE_EPOCH` does not make a clock-reading tool deterministic; it makes
one that honours the convention deterministic, and a tool calling the clock in process
ignores it. The byte-identical property still rests on the tree being clock-free, and
this comparison is what tests that. Refusal 4 keeps the two environments honest about
the recipe they claim to share — it is not a second proof of the same thing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from typing import Any

SCHEMA = "bleavit.app-repro-manifest.v1"

# Keys inside `environment.substantive` that 12 §1.1 fixes as part of the build **recipe**.
# They live in that block because the producer reads them off the environment, which is what
# the convention is; they are classified here because this is where the classification has
# teeth. Each maps to the name an operator would set, so the failure names the thing to fix
# rather than the JSON key it was recorded under.
RECIPE_AXES = {"sourceDateEpoch": "SOURCE_DATE_EPOCH"}

_SHA256_CHARS = set("0123456789abcdef")


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= _SHA256_CHARS


def tree_digest(files: dict[str, str]) -> str:
    """The 12 §1.1 tree hash, recomputed.

    The convention is `app/tools/release/release-json.ts`'s: sha256 over
    `path \\0 <file digest> \\n` for every path in sorted order. Sorted so the digest is
    a function of the tree rather than of read order; path-committing so a renamed tree is
    not reproducible-by-default; `\\0`/`\\n` framed so the serialization is injective
    without borrowing that property from digests all being 64 characters long.

    Emitted paths are restricted to `[A-Za-z0-9._/-]` by the producer, which is what makes
    `sorted()` here and `Array.prototype.sort()` there the same order: over that alphabet
    Python's code-point order and JavaScript's UTF-16 code-unit order coincide.

    Refuses an empty map. Two builds that emitted nothing agree on the digest of nothing,
    and that must never read as two environments reproducing each other.
    """
    if not files:
        raise ValueError("a tree digest over zero files certifies nothing; refusing")
    digest = hashlib.sha256()
    for path in sorted(files):
        file_hash = files[path]
        if not is_sha256(file_hash):
            raise ValueError(f"{path} carries {file_hash!r}, which is not a sha256")
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_hash.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def load_manifest(path: pathlib.Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"{path}: a manifest must be a JSON object")
    if document.get("schema") != SCHEMA:
        raise ValueError(f"{path}: schema is {document.get('schema')!r}, expected {SCHEMA!r}")
    return document


def _files(document: dict[str, Any], label: str) -> dict[str, str]:
    files = document.get("files")
    if not isinstance(files, dict) or not files:
        # Refused rather than read as `{}`: two empty maps compare equal, so an empty one
        # would turn this gate into an unconditional pass exactly when a build emitted
        # nothing. `verify-release diff-scope` refuses an empty `perFileHashes` for the
        # same reason and it is the same failure.
        raise ValueError(f"{label} carries no files; there is nothing to compare")
    return files


def _environment(document: dict[str, Any], label: str) -> dict[str, Any]:
    environment = document.get("environment")
    if not isinstance(environment, dict):
        raise ValueError(f"{label} declares no environment block")
    if not isinstance(environment.get("id"), str) or not environment["id"]:
        raise ValueError(f"{label} declares no environment id")
    substantive = environment.get("substantive")
    if not isinstance(substantive, dict) or not substantive:
        raise ValueError(
            f"{label} records no substantive environment axes, so no difference between "
            "the two environments could ever be shown"
        )
    return environment


def compare_recipe_axes(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    """Refusal 4 — the two environments built the same recipe (12 §1.1, SQ-1009).

    Three ways this can fail, and only the first is the one people picture:

      * the two values differ — a genuine recipe divergence, reported **as one**, because
        the same divergence reported as "these files differ" invites the repair that
        deletes the variable;
      * one side recorded `null` — everywhere else in this manifest `null` means "not
        observable here", which is an honest answer about a *machine*. It is not an
        honest answer about a recipe: 12 §1.1 fixes this value, so an unset one is a
        build that did not follow the recipe rather than a fact nobody could see;
      * neither side recorded it at all — the version of the same repair that removes the
        evidence instead of the disagreement. Two absent keys pass every equality test
        ever written, so absence has to be the failure.
    """
    failures: list[str] = []
    for axis, variable in sorted(RECIPE_AXES.items()):
        left, right = a["substantive"].get(axis, ...), b["substantive"].get(axis, ...)
        missing = [
            environment["id"]
            for environment, value in ((a, left), (b, right))
            if value is ... or value is None
        ]
        if missing:
            failures.append(
                f"{' and '.join(missing)} recorded no {variable}; 12 §1.1 fixes it as part "
                "of the deterministic-build recipe, and an unrecorded one is a build that "
                "did not follow the recipe rather than an environment fact nobody could "
                "observe (two absent values would compare equal and prove nothing)"
            )
            continue
        if left != right:
            failures.append(
                f"the two environments built with different {variable} values "
                f"({a['id']} {left!r}, {b['id']} {right!r}); 12 §1.1 fixes {variable} in the "
                "build recipe, so this is a recipe divergence and not a file difference — "
                "make the two environments agree on the value, never unset it to make the "
                "resulting diff go away"
            )
    return failures


def compare_environments(a: dict[str, Any], b: dict[str, Any]) -> tuple[list[str], list[str]]:
    """`(differing axis descriptions, failures)`.

    A difference counts only between two **known, unequal** values. A `null` on either
    side is "not observable here", and treating it as a difference would let an axis that
    one runner cannot report stand in for independence it never demonstrated.

    `RECIPE_AXES` are excluded from the difference tally entirely. They are recorded in
    the same block, but 12 §1.1 fixes them, so one of them differing is a defect rather
    than evidence — and counting it would let the one axis that must never move be the
    thing that satisfies "these are two environments".
    """
    failures: list[str] = []
    if a["id"] == b["id"]:
        failures.append(
            f"both manifests declare environment id {a['id']!r}; two manifests carrying one "
            "id are one environment, and 12 §1.1 requires two"
        )
    left, right = a["substantive"], b["substantive"]
    if set(left) != set(right):
        # Otherwise a "difference" could come from one side simply not recording an axis,
        # which is a difference between two versions of the producer rather than between
        # two environments.
        only_left = sorted(set(left) - set(right))
        only_right = sorted(set(right) - set(left))
        failures.append(
            "the two manifests record different environment axes "
            f"(only in {a['id']}: {only_left or 'none'}; only in {b['id']}: {only_right or 'none'}); "
            "they were produced by different versions of the manifest tool"
        )
        return [], failures + compare_recipe_axes(a, b)
    failures.extend(compare_recipe_axes(a, b))
    differences = [
        f"{axis}: {left[axis]!r} vs {right[axis]!r}"
        for axis in sorted(left)
        if axis not in RECIPE_AXES
        and left[axis] is not None
        and right[axis] is not None
        and left[axis] != right[axis]
    ]
    if not differences:
        failures.append(
            f"{a['id']} and {b['id']} agree on every recorded environment axis, so this run "
            "proves the build is repeatable on one environment, not that it is reproducible "
            "across two (12 §1.1). Give one of the two jobs a stated difference — the "
            "absolute build path is the axis 12 §1.1's own recorded measurement varied"
        )
    return differences, failures


def compare_files(a: dict[str, str], b: dict[str, str], left: str, right: str) -> list[str]:
    """Every differing path, named. Both directions, so a *missing* file is reported."""
    failures = []
    for path in sorted(set(a) | set(b)):
        in_a, in_b = a.get(path), b.get(path)
        if in_a == in_b:
            continue
        if in_a is None:
            failures.append(f"  only in {right}: {path} ({in_b})")
        elif in_b is None:
            failures.append(f"  only in {left}: {path} ({in_a})")
        else:
            failures.append(f"  differs: {path}\n      {left}: {in_a}\n      {right}: {in_b}")
    return failures


def check(first: dict[str, Any], second: dict[str, Any]) -> tuple[list[str], list[str]]:
    """`(failures, report lines)`. Empty failures means the two builds are byte-identical."""
    failures: list[str] = []
    report: list[str] = []

    environment_a = _environment(first, "the first manifest")
    environment_b = _environment(second, "the second manifest")
    left, right = environment_a["id"], environment_b["id"]

    differences, environment_failures = compare_environments(environment_a, environment_b)
    failures.extend(environment_failures)
    report.append(f"environments: {left} vs {right}")
    for line in differences:
        report.append(f"  differ on {line}")
    # Printed on the healthy path too: a recipe value the run agreed on is evidence, and a
    # gate that only mentions it when it fails leaves a reader unable to tell "both carried
    # the same epoch" from "nobody looked".
    for axis, variable in sorted(RECIPE_AXES.items()):
        shared = environment_a["substantive"].get(axis)
        if shared is not None and shared == environment_b["substantive"].get(axis):
            report.append(f"  agree on {variable}: {shared}")

    for label, document in ((left, first), (right, second)):
        files = _files(document, f"manifest {label}")
        declared = document.get("treeDigest")
        recomputed = tree_digest(files)
        if declared != recomputed:
            failures.append(
                f"manifest {label} declares tree digest {declared!r} and its own file map "
                f"hashes to {recomputed}; the manifest does not describe itself"
            )

    if first.get("sourceCommit") != second.get("sourceCommit"):
        failures.append(
            f"the two builds are of different commits ({left} {first.get('sourceCommit')!r}, "
            f"{right} {second.get('sourceCommit')!r}); there is no reproducibility claim to test"
        )
    else:
        report.append(f"source commit: {first.get('sourceCommit')}")

    if first.get("buildRecipeDigest") != second.get("buildRecipeDigest"):
        failures.append(
            f"the two builds used different recipes ({left} {first.get('buildRecipeDigest')!r}, "
            f"{right} {second.get('buildRecipeDigest')!r}); 12 §1.1's claim is about one recipe"
        )

    files_a, files_b = _files(first, f"manifest {left}"), _files(second, f"manifest {right}")
    file_failures = compare_files(files_a, files_b, left, right)
    if file_failures:
        failures.append(
            f"{len(file_failures)} of {len(set(files_a) | set(files_b))} release file(s) are not "
            f"byte-identical across the two environments (12 §1.1, INV-FE-10):\n"
            + "\n".join(file_failures)
        )
    else:
        report.append(f"{len(files_a)} release files, byte-identical")
        report.append(f"tree digest: {first.get('treeDigest')}")

    return failures, report


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("first", type=pathlib.Path, help="one environment's repro manifest")
    parser.add_argument("second", type=pathlib.Path, help="the other environment's repro manifest")
    arguments = parser.parse_args(argv)

    try:
        first = load_manifest(arguments.first)
        second = load_manifest(arguments.second)
        failures, report = check(first, second)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1

    for line in report:
        print(line)
    if failures:
        # Flushed before the failures go to stderr. Without it the two streams interleave in
        # a CI log and the report lands *after* the diagnosis it is the context for.
        sys.stdout.flush()
        print("", file=sys.stderr)
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print("the two environments produced a byte-identical release (12 §1.1, INV-FE-10)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
