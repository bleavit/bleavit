#!/usr/bin/env python3
"""Bind the ops handbook to 12 §6.1's normative service table (F15).

12 §6 opens with the sentence this checker exists to make true: *"Every row
names an owner role (an accountable person holds each role; assignments are
published in the ops handbook) and a treasury budget line whose amount is
normative in 08."* The document owns the commitments; the handbook owns the
assignments; and nothing before this made the two agree.

The binding is **bidirectional**, for the reason every other gate in this
repository is: a checker that only walked the handbook would pass a handbook
that quietly dropped a service, and a checker that only walked the table would
pass a handbook that invented one. Both are failures, and they are different
failures — a dropped row is a commitment nobody owns, an invented one is a
commitment nobody made.

**A vacant role is declared, never omitted.** This is the design decision worth
stating, because the tempting shape is to list only the roles that are filled.
An omitted row reads as *there is no such commitment*; a row declaring
``holder: VACANT`` reads as *this commitment has no accountable person*, which
is what a launch gate needs to see and what 12 §6.5's phase entries are checked
against. So a blank holder is an error, and ``VACANT`` is a legal value that
``--strict`` refuses.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOC = Path("docs/architecture/12-release-and-operations.md")
DEFAULT_HANDBOOK = Path("deploy/ops-handbook/README.md")

VACANT = "VACANT"


@dataclass(frozen=True)
class ServiceRow:
    service: str
    owner_role: str
    funding_line: str


def strip_markdown(cell: str) -> str:
    """Reduce a table cell to its plain text.

    Link targets, emphasis and parentheticals are decoration; the service name
    is what both sides must agree on. Parentheticals are dropped because several
    rows carry a trailing "(normative values: 13)" that belongs to the value
    rather than to the name.
    """
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    text = text.replace("**", "").replace("`", "").replace("*", "")
    text = re.sub(r"\([^)]*\)", "", text)
    return " ".join(text.split()).strip()


def parse_service_table(doc_text: str) -> list[ServiceRow]:
    """Extract 12 §6.1's rows.

    Scoped to the section rather than to "any four-column table": doc 12 has
    several, and a checker that matched them all would compare the handbook
    against the alert tables and fail for reasons that are not about it.
    """
    start = doc_text.find("### 6.1 Owned-and-funded ops table")
    if start == -1:
        raise SystemExit("12 §6.1's ops table is gone; this gate has nothing to read")
    rest = doc_text[start:]
    end = rest.find("\n### ", 1)
    section = rest if end == -1 else rest[:end]

    rows: list[ServiceRow] = []
    for line in section.splitlines():
        if not line.startswith("|"):
            continue
        cells = [strip_markdown(cell) for cell in line.strip().strip("|").split("|")]
        if len(cells) != 4:
            continue
        service, _commitment, owner_role, funding_line = cells
        if service in {"Service", ""} or set(service) <= set("-: "):
            continue
        rows.append(ServiceRow(service, owner_role, funding_line))
    if not rows:
        raise SystemExit(
            "parsed no service rows out of 12 §6.1; the table shape moved and this gate "
            "would have passed by comparing against nothing"
        )
    return rows


@dataclass(frozen=True)
class Assignment:
    service: str
    owner_role: str
    funding_line: str
    holder: str


ASSIGNMENT = re.compile(
    r"^\|\s*(?P<service>[^|]+?)\s*\|\s*(?P<role>[^|]+?)\s*\|\s*(?P<line>[^|]+?)\s*\|"
    r"\s*(?P<holder>[^|]*?)\s*\|\s*$"
)


def parse_handbook(text: str) -> list[Assignment]:
    start = text.find("## Role assignments")
    if start == -1:
        raise SystemExit("the handbook has no '## Role assignments' section")
    rest = text[start:]
    end = rest.find("\n## ", 1)
    section = rest if end == -1 else rest[:end]

    assignments: list[Assignment] = []
    for line in section.splitlines():
        match = ASSIGNMENT.match(line)
        if not match:
            continue
        service = strip_markdown(match.group("service"))
        if service in {"Service", ""} or set(service) <= set("-: "):
            continue
        holder = match.group("holder").strip()
        if not holder:
            raise SystemExit(
                f"{service}: no holder recorded. A vacancy is declared as {VACANT}, never "
                "left blank — an omitted holder reads as 'no such commitment' rather than "
                "as 'this commitment has nobody accountable'."
            )
        assignments.append(
            Assignment(
                service=service,
                owner_role=strip_markdown(match.group("role")),
                funding_line=strip_markdown(match.group("line")),
                holder=holder,
            )
        )
    return assignments


def check(doc_text: str, handbook_text: str, strict: bool) -> list[str]:
    rows = {row.service: row for row in parse_service_table(doc_text)}
    assignments = {a.service: a for a in parse_handbook(handbook_text)}
    failures: list[str] = []

    for service, row in rows.items():
        assignment = assignments.get(service)
        if assignment is None:
            failures.append(
                f"12 §6.1 names the service {service!r} and the handbook does not assign it. "
                "A dropped row is a commitment nobody owns."
            )
            continue
        if assignment.owner_role != row.owner_role:
            failures.append(
                f"{service}: 12 §6.1 owns it to {row.owner_role!r}, the handbook says "
                f"{assignment.owner_role!r}"
            )
        if assignment.funding_line != row.funding_line:
            failures.append(
                f"{service}: 12 §6.1 funds it from {row.funding_line!r}, the handbook says "
                f"{assignment.funding_line!r}"
            )

    for service in assignments:
        if service not in rows:
            failures.append(
                f"the handbook assigns {service!r}, which 12 §6.1 does not name. An invented "
                "row is a commitment nobody made."
            )

    vacancies = [a.service for a in assignments.values() if a.holder == VACANT]
    if strict and vacancies:
        failures.append(
            f"{len(vacancies)} service(s) have no accountable person: "
            f"{', '.join(sorted(vacancies))}. 12 §6 requires one per row, and 12 §6.5 gates "
            "phase entry on these commitments being live."
        )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--doc", type=Path, default=ROOT / DEFAULT_DOC)
    parser.add_argument("--handbook", type=Path, default=ROOT / DEFAULT_HANDBOOK)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also fail on a declared vacancy — what a launch gate runs, not what CI runs",
    )
    args = parser.parse_args()

    doc_text = args.doc.read_text(encoding="utf-8")
    handbook_text = args.handbook.read_text(encoding="utf-8")
    failures = check(doc_text, handbook_text, args.strict)

    if failures:
        print("Ops handbook does not agree with 12 §6.1:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    rows = parse_service_table(doc_text)
    assignments = parse_handbook(handbook_text)
    vacant = sum(1 for a in assignments if a.holder == VACANT)
    print(
        f"Ops handbook OK — {len(rows)} service commitments bound, "
        f"{len(assignments) - vacant} assigned, {vacant} declared vacant."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
