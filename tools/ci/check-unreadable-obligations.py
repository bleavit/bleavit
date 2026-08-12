#!/usr/bin/env python3
"""Every `UnreadableObligation` the canonical client declares must cite an OPEN question.

`app/packages/transaction-builder/src/rows.ts` carries a list of reads that
11 §11.8 requires and that 02 freezes no surface for. Each entry names the
spec question that owns the gap, and each `blocking` entry closes an
operator control: `operatorGate` turns it into a refusal the user sees, so the
screen cannot reach `ready` while the entry stands.

The file has always said those declarations "expire the way the limit-coverage
registry and the monitoring seams do — by the row closing, not by somebody
remembering to delete a comment". Nothing checked it. Contract v28 froze six
surfaces and SQ-615, SQ-616 and SQ-619 were marked resolved; three
`blocking` entries stayed behind, so the guardian console, the upgrade crank and
the registry challenge panel could not be opened at all — and because they could
never reach `ready`, the suite covering them had settled for asserting the
refusal. A screen nothing can open is a screen nothing has exercised.

So the expiry is mechanical here. One rule:

    every `specQuestion` cited by an `unread(...)` entry is a plan/questions/
    item whose `status:` frontmatter field is "open".

The status is read from `plan/questions/SQ-n.md`'s `status:` enum, not from
prose — `tools.plan.model.load_questions` already parses it that way.

The check deliberately does NOT verify the other direction (that an open
question has a declaration): most questions have nothing to do with this table.
What it catches is the one asymmetry that closes a screen silently.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROWS_TS = ROOT / "app/packages/transaction-builder/src/rows.ts"

sys.path.insert(0, str(ROOT))
from tools.plan.model import load_questions  # noqa: E402

# `unread(row, requirement, reason, specQuestion, disposition, scope?)` — the id
# and the disposition are string literals in the fourth and fifth positions.
# Matched on the pair rather than on the id alone so a malformed entry is
# reported rather than skipped.
#
# The optional sixth argument is an `ObligationScope` object literal, which
# narrows a blocking obligation to the dispatch arm that actually reads the
# condition. It is skipped rather than parsed: this checker's one rule is about
# the cited question's status, and a scope changes *which pending actions* an
# obligation speaks about, never *whether it has expired*. Tolerating it here
# keeps that separation — a scoped entry whose question closes is still caught.
UNREAD_RE = re.compile(
    r"\bunread\(\s*(?P<body>.*?)\)\s*,\s*\n",
    re.DOTALL,
)
TAIL_RE = re.compile(
    r"'(?P<sq>SQ-\d+)'\s*,\s*'(?P<disposition>stated|blocking)'\s*,"
    r"(?:\s*\{[^{}]*\}\s*,?)?\s*$",
    re.DOTALL,
)


def load_question_statuses(root: Path) -> tuple[dict[str, str], list[str]]:
    """`SQ-n` -> "open" | "resolved", from the plan/ item tree.

    Replaces a reading that asked whether a status *cell* began with the word
    "open" — necessary while the cell was prose, because an open row's prose
    legitimately contains the word "resolved". `status` is now an enum.
    """
    items, errors = load_questions(root)
    return {item.id: item.status for item in items}, errors


def declarations(source: str) -> list[tuple[int, str, str]]:
    """(line number, spec question, disposition) for every `unread(...)` entry."""
    found: list[tuple[int, str, str]] = []
    for match in UNREAD_RE.finditer(source):
        body = match.group("body")
        tail = TAIL_RE.search(body)
        lineno = source.count("\n", 0, match.start()) + 1
        if tail is None:
            found.append((lineno, "", ""))
            continue
        found.append((lineno, tail.group("sq"), tail.group("disposition")))
    return found


def main() -> int:
    source = ROWS_TS.read_text(encoding="utf-8")
    status, load_errors = load_question_statuses(ROOT)
    if load_errors:
        # Fail closed: a parse error is not "nothing to check". Treating it as
        # such would let a broken plan/questions/ tree pass every citation.
        for error in load_errors:
            print(error, file=sys.stderr)
        return 1
    if not status:
        print("plan/questions/: no spec questions found", file=sys.stderr)
        return 1

    entries = declarations(source)
    if not entries:
        # Zero declarations is a legitimate end state — it means every §11.8 read
        # has a frozen surface. It is reported rather than silently passing,
        # because it is also what a broken parser looks like.
        print("No unreadable obligations declared. Either every §11.8 read is frozen, or this parser stopped matching.")
        return 0

    errors: list[str] = []
    for lineno, sq, disposition in entries:
        where = f"{ROWS_TS.relative_to(ROOT)}:{lineno}"
        if not sq:
            errors.append(f"{where}: an unread(...) entry does not end in a spec-question id and a disposition")
            continue
        state = status.get(sq)
        if state is None:
            errors.append(f"{where}: cites {sq}, which is not a plan/questions/ item")
        elif state != "open":
            errors.append(
                f"{where}: cites {sq}, which is recorded RESOLVED. "
                f"This declaration is {disposition}"
                + (
                    " — it closes an operator control for a reason that no longer holds, "
                    "and a control that can never open is one nothing has exercised."
                    if disposition == "blocking"
                    else " — it tells the user a condition cannot be checked when its surface now exists."
                )
            )

    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1

    blocking = sum(1 for _, _, d in entries if d == "blocking")
    print(
        f"Unreadable obligations OK — {len(entries)} declared "
        f"({blocking} blocking), every one citing an open spec question."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
