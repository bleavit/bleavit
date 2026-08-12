#!/usr/bin/env python3
"""Check question batch assignments against the plan/batches/ registry.

The split plan tree makes duplicate question ids and multiple batch assignments
structurally impossible: an id is a filename and `batch:` is one scalar. This
gate retains the independent guarantees: labels are declared, open questions
are batched, resolved questions are unbatched, and declared counts match.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.plan.model import PlanError, load_questions, parse_frontmatter  # noqa: E402

UNBATCHED = "none"
BATCH_KEYS = {"id", "title", "rows", "status"}


def load_batches(root: Path) -> tuple[set[str], dict[str, int], list[str]]:
    directory = root / "plan" / "batches"
    if not directory.is_dir():
        return {UNBATCHED}, {}, ["plan/batches/: directory is missing"]
    declared = {UNBATCHED}
    rows: dict[str, int] = {}
    errors: list[str] = []
    for path in sorted(directory.glob("*.md")):
        try:
            values, _body = parse_frontmatter(path)
        except PlanError as error:
            errors.append(str(error))
            continue
        if set(values) != BATCH_KEYS:
            errors.append(f"{path}: keys must be exactly {sorted(BATCH_KEYS)}")
            continue
        identifier = values["id"]
        if not isinstance(identifier, str) or identifier != path.stem:
            errors.append(f"{path}: id {identifier!r} does not match its filename")
            continue
        status = values["status"]
        if status not in {"open", "closed"}:
            errors.append(f"{path}: status must be open or closed")
            continue
        try:
            count = int(values["rows"])
        except (TypeError, ValueError):
            errors.append(f"{path}: rows must be a non-negative integer")
            continue
        if count < 0:
            errors.append(f"{path}: rows must be a non-negative integer")
            continue
        if status == "closed" and count != 0:
            errors.append(f"{path}: a closed batch must declare zero rows")
            continue
        declared.add(identifier)
        rows[identifier] = count
    return declared, rows, errors


def declared_batches(root: Path) -> set[str]:
    return load_batches(root)[0]


def batch_row_counts(root: Path) -> dict[str, int]:
    return load_batches(root)[1]


def check(root: Path) -> list[str]:
    items, errors = load_questions(root)
    declared, rows, batch_errors = load_batches(root)
    errors.extend(batch_errors)
    actual_counts: dict[str, int] = {}

    for item in items:
        if item.batch not in declared:
            errors.append(
                f"plan/questions/{item.id}.md: batch {item.batch!r} is not a declared batch"
            )
            continue
        if item.status == "open" and item.batch == UNBATCHED:
            errors.append(f"plan/questions/{item.id}.md: {item.id} is OPEN but assigned to no batch")
        if item.status == "resolved" and item.batch != UNBATCHED:
            errors.append(
                f"plan/questions/{item.id}.md: {item.id} is RESOLVED but still named by batch"
                f" {item.batch!r} — set batch: none"
            )
        if item.batch != UNBATCHED:
            actual_counts[item.batch] = actual_counts.get(item.batch, 0) + 1

    for label, declared_count in sorted(rows.items()):
        actual = actual_counts.get(label, 0)
        if declared_count != actual:
            errors.append(
                f"batch {label} declares {declared_count} rows but"
                f" {actual} plan/questions/ item(s) name it"
            )
    return errors


def main(argv: list[str]) -> int:
    target = Path(argv[0]) if argv else ROOT
    if not target.is_absolute():
        target = ROOT / target
    errors = check(target)
    if errors:
        print("Spec-question batch-index errors:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(
        "Spec-question batches OK — labels are declared, open questions are batched, "
        "resolved questions are unbatched, and declared counts match."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
