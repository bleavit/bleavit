#!/usr/bin/env python3
"""Bind the human quickstart's executable block to the N10 drill helper."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = Path("docs/integration/quickstart.md")
SOURCE = Path("zombienet/drills/js/client-quickstart.js")
DRILL = Path("zombienet/drills/10-client-integration.zndsl")
BEGIN = "<!-- quickstart-drill-source:begin -->"
END = "<!-- quickstart-drill-source:end -->"
BLOCK = re.compile(
    re.escape(BEGIN) + r"\r?\n```javascript\r?\n(.*?)^```\r?\n" + re.escape(END),
    re.MULTILINE | re.DOTALL,
)


def read(path: Path, failures: list[str]) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        failures.append(f"cannot read {path}: {error}")
        return None


def validate(root: Path, node: str = "node") -> list[str]:
    failures: list[str] = []
    doc_text = read(root / DOC, failures)
    source_text = read(root / SOURCE, failures)
    drill_text = read(root / DRILL, failures)
    if doc_text is None or source_text is None or drill_text is None:
        return failures

    blocks = BLOCK.findall(doc_text)
    if len(blocks) != 1:
        failures.append(
            f"{DOC}: expected exactly one {BEGIN}…{END} JavaScript source block, found {len(blocks)}"
        )
    elif blocks[0] != source_text:
        failures.append(
            f"{DOC}: executable block differs from {SOURCE}; edit the source file and include it verbatim"
        )

    if "js-script ./js/client-quickstart.js" not in drill_text:
        failures.append(f"{DRILL}: does not execute ./js/client-quickstart.js")

    try:
        checked = subprocess.run(
            [node, "--check", str(root / SOURCE)],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        failures.append(f"cannot execute {node} --check: {error}")
    else:
        if checked.returncode != 0:
            detail = (checked.stderr or checked.stdout).strip()
            failures.append(f"{SOURCE}: node --check failed: {detail}")
    return failures


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--node", default="node")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    failures = validate(args.root.resolve(), args.node)
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return 1
    print(f"quickstart-drill-binding: {DOC} includes {SOURCE} verbatim and the helper parses")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
