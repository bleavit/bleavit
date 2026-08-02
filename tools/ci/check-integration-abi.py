#!/usr/bin/env python3
"""Bind the pure-XCM integration page to the frozen wire ABI.

`docs/integration/integrate-xcm.md` publishes the call selectors and asset
identifiers a client encodes **without** Bleavit metadata. That is exactly the
kind of number that rots silently: nothing else in the repository reads the
page, so a renumbered call index would leave every hand-rolled integration
building bytes Bleavit refuses, with no failing test anywhere.

This checker makes the page a consumer of the constants rather than a copy of
them. It is bidirectional on the call table — every frozen selector must appear
in the doc, and every row in the doc must match a frozen selector — because a
one-directional check accepts a stale row for a call that no longer exists.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = Path("docs/integration/integrate-xcm.md")
ABI = Path("crates/bleavit-client-abi/src/lib.rs")
PRIMITIVES = Path("crates/futarchy-primitives/src/lib.rs")

# ABI constant name -> the call name the doc's table row must carry.
CALL_CONSTANTS = {
    "REGISTER_QUESTION_CALL_INDEX": "register",
    "BOND_ATTESTOR_CALL_INDEX": "bond_attestor",
    "OPEN_QUESTION_CALL_INDEX": "open",
    "SEAL_QUESTION_CALL_INDEX": "seal",
    "SUBMIT_ATTESTATION_CALL_INDEX": "submit_attestation",
    "SETTLE_QUESTION_CALL_INDEX": "settle",
}

# The three calls the positional ingress template may carry (16 §2; 09 §6.5).
# The rest require a signed origin, so a doc that advertised them over XCM would
# send integrators down a path that always fails at the call filter.
XCM_REACHABLE = {"register", "open", "seal"}

RUST_CONST = r"pub const {name}\s*:\s*[A-Za-z0-9_]+\s*=\s*(\d+)"
# | `register` | 0 | **yes** | ... |
DOC_CALL_ROW = re.compile(
    r"^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|", re.MULTILINE
)


def read(path: Path, failures: list[str]) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        failures.append(f"cannot read {path}: {error}")
        return None


def rust_const(text: str, name: str, source: Path, failures: list[str]) -> int | None:
    match = re.search(RUST_CONST.format(name=re.escape(name)), text)
    if match is None:
        failures.append(f"{source}: constant {name} is absent; the doc binding cannot be checked")
        return None
    return int(match.group(1))


def validate(root: Path) -> list[str]:
    failures: list[str] = []
    doc = read(root / DOC, failures)
    abi = read(root / ABI, failures)
    primitives = read(root / PRIMITIVES, failures)
    if doc is None or abi is None or primitives is None:
        return failures

    pallet_index = rust_const(abi, "QUESTION_SERVICE_PALLET_INDEX", ABI, failures)
    if pallet_index is not None and f"pallet index {pallet_index}" not in doc:
        failures.append(
            f"{DOC}: must state 'pallet index {pallet_index}' to match "
            f"QUESTION_SERVICE_PALLET_INDEX in {ABI}"
        )

    # The report-push selector the doc publishes as `[66, 0] ++ SCALE(ReportView)`.
    receiver = rust_const(abi, "CLIENT_RECEIVER_PALLET_INDEX", ABI, failures)
    receive_call = rust_const(abi, "RECEIVE_REPORT_CALL_INDEX", ABI, failures)
    if receiver is not None and receive_call is not None:
        selector = f"[{receiver}, {receive_call}] ++ SCALE(ReportView)"
        if selector not in doc:
            failures.append(f"{DOC}: must publish the push selector `{selector}`")

    documented = {name: int(index) for name, index, _ in DOC_CALL_ROW.findall(doc)}
    reachability = {name: cell for name, _, cell in DOC_CALL_ROW.findall(doc)}

    for constant, call in CALL_CONSTANTS.items():
        index = rust_const(abi, constant, ABI, failures)
        if index is None:
            continue
        if call not in documented:
            failures.append(f"{DOC}: no table row documents `{call}` (frozen index {index})")
            continue
        if documented[call] != index:
            failures.append(
                f"{DOC}: `{call}` is documented as index {documented[call]}, "
                f"but {constant} is {index}"
            )
        # A call reachable over XCM that the doc marks unreachable (or the
        # reverse) sends integrators to a guaranteed refusal.
        says_yes = "yes" in reachability[call].lower()
        if says_yes != (call in XCM_REACHABLE):
            failures.append(
                f"{DOC}: `{call}` XCM-reachability row says {reachability[call]!r}, "
                f"but it is {'' if call in XCM_REACHABLE else 'not '}an ExternalClient call"
            )

    for call in documented:
        if call not in CALL_CONSTANTS.values():
            failures.append(
                f"{DOC}: documents call `{call}`, which is not a frozen selector in {ABI}"
            )

    # The USDC location the client must name in template positions 0 and 1.
    para = rust_const(primitives, "ASSET_HUB_PARA_ID", PRIMITIVES, failures)
    instance = rust_const(primitives, "USDC_PALLET_INSTANCE", PRIMITIVES, failures)
    index = rust_const(primitives, "USDC_ASSET_INDEX", PRIMITIVES, failures)
    if None not in (para, instance, index):
        location = f"X3(Parachain({para}), PalletInstance({instance}), GeneralIndex({index}))"
        if location not in doc:
            failures.append(f"{DOC}: must publish the USDC location `{location}`")

    attestors = rust_const(primitives, "MAX_SERVICE_ATTESTORS", PRIMITIVES, failures)
    if attestors is not None and f"BoundedVec<[u8; 32], {attestors}>" not in doc:
        failures.append(
            f"{DOC}: must publish the attestor bound as `BoundedVec<[u8; 32], {attestors}>`"
        )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()

    failures = validate(args.root)
    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    if failures:
        return 1
    print("docs/integration/integrate-xcm.md agrees with the frozen client ABI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
