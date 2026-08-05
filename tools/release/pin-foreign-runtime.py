#!/usr/bin/env python3
"""Pin a **foreign** chain's runtime as a release artifact — 02 §7.7, §13 rule 8 (F4).

Every other runtime this repository pins is one it builds. Asset Hub is not: [11] §11.9.1
opens a second light-client connection to it, reads the user's USDC there and submits an
AH-side reserve transfer, so its layout is contract surface that no Bleavit build produces
and no Bleavit constant can attest. 02 §13 rule 8 states the consequence normatively —
`INTEGRATION_CONTRACT_VERSION` deliberately does **not** move for §7.7 — and says where the
pin lives instead: *the release's own artifact feed, by that chain's genesis hash,
`spec_version` and metadata hash.* This script writes that record.

## What is verified here, and what cannot be

**The runtime artifact is verified, twice over.** The wasm is a published, reproducibly
built release artifact, and its srtool digest is fetched alongside it: this script refuses
unless `sha256(wasm)` equals the digest's own `runtimes.compressed.sha256`, so a wasm that
was swapped after the digest was published cannot be pinned. The digest's `core_version` is
copied into the record rather than restated, which is what lets a later reader check the
pin against the upstream release without trusting this file.

**The genesis hash cannot come from an artifact, and saying otherwise would be a fiction.**
Genesis is chain identity — a property of the *chain spec's genesis storage*, not of the
runtime — so no amount of runtime provenance produces it. It is therefore supplied by the
caller, having been read from the live chain, which is exactly what R-2 prescribes for a
`[VERIFY]` and exactly what 10 §5.1 forbids for *descriptor generation*. The two rules do
not conflict because they govern different things: descriptors are generated from the wasm
this script pins, and the genesis hash is an identity fact verified against live sources
and logged. `--genesis-sources` records **who was asked**, and the script requires at least
two independent ones, because one operator agreeing with itself is not a cross-check.

## Why the metadata blob is v16 and the repo's own decoder cannot read it

`tools/release/extract-metadata.py` gets v15 by booting the runtime in a node and calling
`Metadata_metadata_at_version`. That path is unavailable here — `bleavit-node` boots a
Bleavit chain spec, and a foreign runtime has neither the genesis config nor the pallets it
expects. PAPI reads metadata **straight out of the wasm** (V-76) and returns v16, which
`scale_metadata.py` does not implement.

The consequence is stated rather than worked around: **the surface-presence check for a
foreign feed cannot live in Python.** It lives in TypeScript, over the same decoder that
produces the descriptors — which is the better place for it anyway, since what must be
proven present is what the *client* will be able to name.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

SCHEMA = "bleavit.foreign-runtime-info.v1"


def sha256_file(path: Path) -> str:
    return "0x" + hashlib.sha256(path.read_bytes()).hexdigest()


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True, help="user-facing chain name, e.g. 'Asset Hub'")
    ap.add_argument("--chain-key", required=True, help="descriptor key, e.g. assethub_paseo")
    ap.add_argument("--relay", required=True, help="the relay this Asset Hub belongs to")
    ap.add_argument("--wasm", required=True, type=Path)
    ap.add_argument("--srtool-digest", required=True, type=Path)
    ap.add_argument("--metadata", required=True, type=Path, help="PAPI-extracted metadata blob")
    ap.add_argument("--genesis", required=True)
    ap.add_argument(
        "--genesis-source",
        action="append",
        default=[],
        required=True,
        help="an endpoint the genesis hash was read from; repeat (>= 2 required)",
    )
    ap.add_argument("--source-url", required=True, help="where the wasm was published")
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    if len(set(args.genesis_source)) < 2:
        fail(
            "at least two DISTINCT genesis sources are required. One operator agreeing with "
            "itself is not a cross-check, and chain identity is the field whose error makes "
            "every balance the client renders belong to somebody else."
        )
    if not (args.genesis.startswith("0x") and len(args.genesis) == 66):
        fail(f"genesis hash must be 0x + 64 hex digits, got {args.genesis!r}")

    digest = json.loads(args.srtool_digest.read_text())
    try:
        compressed = digest["runtimes"]["compressed"]
        published_sha = compressed["sha256"]
        core = compressed["subwasm"]["core_version"]
    except (KeyError, TypeError):
        fail("srtool digest does not carry runtimes.compressed.{sha256,subwasm.core_version}")

    measured_sha = sha256_file(args.wasm)
    if measured_sha != published_sha:
        fail(
            f"wasm sha256 {measured_sha} != srtool digest {published_sha}. The artifact and "
            "the digest that vouches for it disagree; refusing to pin either."
        )

    blob = args.metadata.read_bytes()
    if blob[:4] != b"meta":
        fail(f"{args.metadata} is not a SCALE metadata blob (magic {blob[:4]!r})")

    spec_version = core["specVersion"]
    out = args.out_dir / str(spec_version)
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.metadata, out / "metadata.scale")

    record = {
        "schema": SCHEMA,
        "label": args.label,
        "chain_key": args.chain_key,
        "relay": args.relay,
        "genesis_hash": args.genesis,
        # Recorded, not asserted: a reader can re-ask these and get the same answer, or
        # find out that the pin has gone stale. A bare hash says neither.
        "genesis_sources": sorted(set(args.genesis_source)),
        "core_version": {
            "spec_name": core["specName"],
            "spec_version": spec_version,
            "transaction_version": core["transactionVersion"],
            "state_version": core["stateVersion"],
        },
        "artifact": {
            "source_url": args.source_url,
            "file": args.wasm.name,
            "sha256": measured_sha,
            "srtool_version": digest.get("info", {}).get("version") or digest.get("version"),
            "srtool_blake2_256": compressed.get("blake2_256"),
        },
        "metadata": {
            # PAPI reads v16 from the wasm; `scale_metadata.py` stops at v15. The version is
            # recorded so the TypeScript-side gate can refuse a blob it cannot decode rather
            # than silently producing a smaller descriptor set.
            "version": 16,
            "sha256": sha256_file(out / "metadata.scale"),
            "bytes": len(blob),
            "extracted_by": "papi add --wasm (polkadot-api 2.1.8)",
        },
    }
    (out / "runtime-info.json").write_text(json.dumps(record, indent=2) + "\n")
    print(f"OK  {args.chain_key} spec {spec_version} pinned into {out}")
    print(f"    wasm     {measured_sha}  (srtool-confirmed)")
    print(f"    genesis  {args.genesis}  ({len(set(args.genesis_source))} independent sources)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
