#!/usr/bin/env python3
"""Refuse mutable third-party GitHub Action refs in committed workflows.

An action executes before ordinary repository gates can protect the job, and the
release publisher carries ``contents: write``.  Every non-local ``uses:`` entry
therefore names an immutable 40-hex commit and leaves a reviewed version comment
for humans and dependency-update automation.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
from collections.abc import Iterator

import yaml
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode


USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#\s*(\S.*))?\s*$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
# Marketplace actions normally have a semantic-version tag.  The
# rust-toolchain action instead publishes toolchain-named branches, so its
# reviewed identity is the exact Rust release/nightly date selected by the
# workflow rather than a nonexistent action version.
VERSION_COMMENT = re.compile(
    r"^(?:v?[0-9]+(?:\.[0-9]+){1,2}(?:[-+][0-9A-Za-z.-]+)?"
    r"|nightly-[0-9]{4}-[0-9]{2}-[0-9]{2})$"
)


def _uses_nodes(node: Node | None) -> Iterator[tuple[ScalarNode, Node]]:
    """Yield every semantic ``uses`` mapping key, including aliases/inline maps."""

    if isinstance(node, MappingNode):
        for key, value in node.value:
            if isinstance(key, ScalarNode) and key.value == "uses":
                yield key, value
            yield from _uses_nodes(value)
    elif isinstance(node, SequenceNode):
        for value in node.value:
            yield from _uses_nodes(value)


def check_workflow(path: pathlib.Path) -> list[str]:
    failures: list[str] = []
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    try:
        document = yaml.compose(source)
    except yaml.YAMLError as error:
        return [f"{path}: cannot parse workflow YAML: {error}"]
    for key, value in _uses_nodes(document):
        line_number = key.start_mark.line + 1
        line = lines[key.start_mark.line]
        match = USES.match(line)
        if match is None:
            failures.append(
                f"{path}:{line_number}: uses must use canonical one-line syntax so its "
                "immutable ref and review label cannot hide behind aliases, quoting, or "
                "inline mappings"
            )
            continue
        target, comment = match.groups()
        if not isinstance(value, ScalarNode) or value.value != target:
            failures.append(
                f"{path}:{line_number}: uses source does not match its resolved scalar value"
            )
            continue
        if target.startswith("./"):
            continue
        if "@" not in target:
            failures.append(f"{path}:{line_number}: third-party action has no ref: {target}")
            continue
        action, ref = target.rsplit("@", 1)
        if FULL_SHA.fullmatch(ref) is None:
            failures.append(
                f"{path}:{line_number}: {action} uses mutable/non-full ref {ref!r}"
            )
        if comment is None or VERSION_COMMENT.fullmatch(comment) is None:
            failures.append(
                f"{path}:{line_number}: {action} pin needs an exact version comment "
                "such as '# v4.2.2', '# 1.89.0', or '# nightly-2025-11-24'"
            )
    return failures


def check_directory(root: pathlib.Path) -> list[str]:
    failures: list[str] = []
    workflows = sorted((*root.glob("*.yml"), *root.glob("*.yaml")))
    if not workflows:
        return [f"{root}: no workflow files found; action-pin coverage would be vacuous"]
    for path in workflows:
        failures.extend(check_workflow(path))
    return failures


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workflows",
        type=pathlib.Path,
        default=pathlib.Path(".github/workflows"),
        help="workflow directory (default: .github/workflows)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    failures = check_directory(args.workflows)
    if failures:
        print("workflow action pin check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("workflow action pins: every third-party use is full-SHA pinned and version-commented")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
