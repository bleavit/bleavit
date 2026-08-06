#!/usr/bin/env python3
"""The design kit's derived copies really are verbatim.

`docs/design/claude-design-kit/` ships two `*-VERBATIM.md` files, each declaring itself a
verbatim copy of a `docs/architecture/` document and each saying *"if this copy and the
source ever differ, the source wins"*. Nothing checked that. AGENTS.md obliges a
regeneration after any spec change, `check-doc-links.py` already special-cases these files
so their relative links are not resolved against the wrong directory — and neither of those
is the same as comparing the bytes.

They had drifted. `04-frontend-workflows-and-screens-VERBATIM.md` was three lines behind
doc 11 when this gate was written: a resolved `[VERIFY asset index 1337]` had become a
per-release pin in the source while the kit still published the unresolved tag. The failure
is quiet by construction — a design tool is fed the copy, not the source, so the copy being
wrong looks exactly like the source being wrong, and the person reading it has no way to
tell which.

What is checked: the body — everything from the first level-1 heading onward — must be
**byte-identical** to the source the header names. The header itself is deliberately not
checked; it is hand-written context for whoever regenerates, and a gate over prose would
either be vacuous or would stop people writing it.

`--write` regenerates the bodies in place, leaving each header alone.

Anti-vacuity: finding no copies, a header that names no source, or a header naming a source
that does not exist are all errors. A gate that silently checked nothing would reproduce the
condition it exists to end.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
KIT = ROOT / "docs" / "design" / "claude-design-kit"

SOURCE_CLAIM = re.compile(r"Verbatim copy of `([^`]+)`", re.UNICODE)
BODY_START = re.compile(r"^# ", re.MULTILINE)


def split(copy: pathlib.Path) -> tuple[str, str, pathlib.Path]:
    """The copy's header, its body, and the source its header claims."""
    text = copy.read_text(encoding="utf-8")
    claim = SOURCE_CLAIM.search(text)
    if claim is None:
        raise SystemExit(
            f"FAIL {copy.relative_to(ROOT)} does not say what it is a copy of. The header must "
            "carry ``Verbatim copy of `docs/architecture/<file>`'' — without it nothing can "
            "check the copy, which is how this file class drifted in the first place."
        )
    start = BODY_START.search(text)
    if start is None:
        raise SystemExit(
            f"FAIL {copy.relative_to(ROOT)} has no level-1 heading, so its header and body "
            "cannot be told apart"
        )
    source = ROOT / claim.group(1)
    if not source.is_file():
        raise SystemExit(
            f"FAIL {copy.relative_to(ROOT)} claims to copy {claim.group(1)}, which does not "
            "exist. Either the source moved and the header was not updated, or the copy is "
            "now orphaned — both leave a design tool reading a document nothing owns."
        )
    return text[: start.start()], text[start.start() :], source


def first_difference(body: str, source: str) -> str:
    """Where the two diverge, in the terms someone fixing it needs."""
    theirs, ours = source.split("\n"), body.split("\n")
    for index, (a, b) in enumerate(zip(ours, theirs), start=1):
        if a != b:
            return (
                f"line {index} of the body differs\n"
                f"       copy: {a[:160]}\n"
                f"     source: {b[:160]}"
            )
    longer, who = (
        (len(ours) - len(theirs), "copy") if len(ours) > len(theirs) else (len(theirs) - len(ours), "source")
    )
    return f"the {who} has {longer} extra line(s); the copy is truncated or has trailing content"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write", action="store_true", help="regenerate each body from its source, keeping headers"
    )
    args = parser.parse_args()

    copies = sorted(KIT.glob("*-VERBATIM.md"))
    if not copies:
        raise SystemExit(
            f"FAIL no `*-VERBATIM.md` under {KIT.relative_to(ROOT)}. Either the kit was removed — "
            "in which case delete this gate deliberately — or the naming changed and this gate "
            "has been checking nothing."
        )

    stale: list[str] = []
    for copy in copies:
        header, body, source = split(copy)
        expected = source.read_text(encoding="utf-8")
        if body == expected:
            print(f"OK  {copy.name} is byte-identical to {source.relative_to(ROOT)}")
            continue
        if args.write:
            copy.write_text(header + expected, encoding="utf-8")
            print(f"WROTE {copy.name} from {source.relative_to(ROOT)} — update its header note")
            continue
        stale.append(
            f"{copy.relative_to(ROOT)} has drifted from {source.relative_to(ROOT)}:\n"
            f"  {first_difference(body, expected)}"
        )

    if stale:
        for entry in stale:
            print(f"FAIL {entry}", file=sys.stderr)
        print(
            "\nRegenerate with `python3 tools/ci/check-verbatim-copies.py --write` and update the "
            "header note to say what the regeneration picked up. The source always wins — these "
            "files say so themselves.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
