#!/usr/bin/env python3
"""Every `execute` reason code the canonical client shows is one the runtime returns.

11 §11.5's `execution_guard.execute` row ends with an obligation that is easy to read
past: *"any failure blocks with the same reason code the runtime would return."* Nothing
checked it. The client's `ExecuteErrorCode` union carried four names
`pallet_execution_guard::Error<T>` has never had —

  * `NotQueued`      for the guard's `NotFound` / `Cancelled`,
  * `VersionMismatch` for `StaleQueue`,
  * `MeterExceeded`   for `MetersBlocked`,
  * `GateSuspended`   standing in for `GuardianHold` on the `delay_once` arm,

— so a user refused by the rate meters was shown a code that appears nowhere in the
runtime, in the one panel whose whole job is telling them what the chain will say.

This is the same defect shape `check-dispatch-mirror.py` exists for, one layer down. That
gate binds two *documents*; nothing bound the client's code table to its *source*, and a
code table with no mechanical binding is an unfalsifiable claim: it reads correct, it
compiles, and every test written against it agrees with it.

## What is checked

1. Every member of the client's `ExecuteErrorCode` union is a variant of the pallet's
   `#[pallet::error] enum Error<T>`.
2. Doc 11 still states the obligation this gate enforces. If that sentence goes, the gate
   is enforcing a rule nobody has written down and says so rather than passing quietly.

## What is deliberately NOT checked

The binding is **one-directional**. The guard declares many variants `execute` cannot
reach — the upgrade path (`BadUpgradePayload`, `PendingUpgradeExists`, `NoPendingUpgrade`,
`UpgradeHashMismatch`), queue admission (`QueueFull`), the recovery lane — and requiring
each to appear in the client would be requiring the client to model checks it never makes.
A gate that demanded that would be wrong in the direction that gets a gate switched off.

Nor does it check that each code is attached to the *right row*: that is a semantic claim
about which `ensure!` a row mirrors, and it lives in `tests/screens` beside the row, bound
to the pallet line numbers. What is mechanical here is the vocabulary, which is exactly the
half that drifted.

Usage:  python3 tools/ci/check-execute-error-codes.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PALLET = ROOT / "pallets" / "execution-guard" / "src" / "lib.rs"
CLIENT = ROOT / "app" / "src" / "features" / "tx" / "src" / "execution-queue.ts"
DOC_11 = ROOT / "docs" / "architecture" / "11-frontend-workflows.md"

# The sentence this gate exists to enforce. Bound rather than paraphrased: a gate whose
# rule has quietly left the specification is enforcing its author's memory.
OBLIGATION = "blocks with the same reason code the runtime would return"

# --- anti-vacuity ---------------------------------------------------------
#
# Both parses can fail open. A regex that stops matching yields an empty client union
# (nothing to check) or an empty pallet enum (which would fail everything, so it is the
# less dangerous direction). Floors are measured values held well below the measurement so
# ordinary edits do not trip them, and the named controls are what a count alone cannot do:
# a count survives a regex matching the wrong thing.
MIN_PALLET_VARIANTS = 20
MIN_CLIENT_CODES = 10
PALLET_CONTROLS = ("NotFound", "Cancelled", "GraceExpired", "MetersBlocked", "GuardianHold")
CLIENT_CONTROLS = ("GraceExpired", "MetersBlocked", "GuardianHold", "StaleQueue")


def pallet_variants(text: str) -> list[str]:
    """The variant names of `#[pallet::error] pub enum Error<T> { … }`."""
    start = text.find("#[pallet::error]")
    if start < 0:
        raise SystemExit(
            f"FAIL cannot find `#[pallet::error]` in {PALLET.relative_to(ROOT)}. Either the "
            "attribute moved — update this checker — or the pallet no longer declares its "
            "errors there, in which case nothing binds the client's codes to anything."
        )
    open_brace = text.find("{", start)
    close_brace = text.find("\n    }", open_brace)
    if open_brace < 0 or close_brace < 0:
        raise SystemExit("FAIL the error enum has no parseable body; the gate would be guessing")
    body = text[open_brace + 1 : close_brace]
    # Variants are bare CamelCase identifiers on their own line. Fielded variants and
    # doc comments are tolerated: the name is what this gate compares.
    return re.findall(r"^\s{8}([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|,)", body, re.MULTILINE)


def client_codes(text: str) -> list[str]:
    """The string-literal members of `export type ExecuteErrorCode = …`."""
    match = re.search(r"export type ExecuteErrorCode =([^;]*);", text)
    if match is None:
        raise SystemExit(
            f"FAIL cannot find `export type ExecuteErrorCode` in {CLIENT.relative_to(ROOT)}. "
            "The client's reason-code vocabulary is what this gate binds to the runtime; "
            "without it there is nothing to check and a pass would mean nothing."
        )
    return re.findall(r"'([A-Za-z0-9]+)'", match.group(1))


def main() -> int:
    variants = pallet_variants(PALLET.read_text(encoding="utf-8"))
    codes = client_codes(CLIENT.read_text(encoding="utf-8"))
    doc = DOC_11.read_text(encoding="utf-8")

    problems: list[str] = []

    if len(variants) < MIN_PALLET_VARIANTS:
        problems.append(
            f"parsed only {len(variants)} pallet error variant(s) (floor {MIN_PALLET_VARIANTS}); "
            "the enum parse is broken and every comparison below is against a stub"
        )
    missing_controls = [c for c in PALLET_CONTROLS if c not in variants]
    if missing_controls:
        problems.append(
            f"the pallet parse did not find the control variant(s) {missing_controls}; it is "
            "matching something other than the error enum"
        )

    if len(codes) < MIN_CLIENT_CODES:
        problems.append(
            f"parsed only {len(codes)} client code(s) (floor {MIN_CLIENT_CODES}); the union "
            "parse is broken, so an unbound code would pass unnoticed"
        )
    missing_client = [c for c in CLIENT_CONTROLS if c not in codes]
    if missing_client:
        problems.append(
            f"the client union no longer carries {missing_client} — these are the codes the "
            "runtime returns for the queue-state, meter, guardian-hold and version checks, "
            "and a client that stopped naming them is reporting something else instead"
        )

    if OBLIGATION not in doc:
        problems.append(
            f"11 §11.5 no longer states {OBLIGATION!r}; this gate would be enforcing a rule "
            "that has left the specification"
        )

    known = set(variants)
    unbound = [code for code in codes if code not in known]
    if unbound:
        problems.append(
            f"the client reports {unbound}, which `pallet_execution_guard::Error<T>` does not "
            "declare — 11 §11.5 requires the code the runtime would return, and a name the "
            "runtime has never returned tells the user something the chain did not say"
        )

    if problems:
        print("FAIL execute reason codes (11 §11.5):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print(
        f"OK  execute reason codes: {len(codes)} client code(s) all declared among "
        f"{len(variants)} pallet_execution_guard::Error variant(s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
