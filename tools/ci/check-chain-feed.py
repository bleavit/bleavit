#!/usr/bin/env python3
"""The cheap per-commit leg of the F2 descriptor-drift gate (02 §11, 10 §5).

## Why this exists, concretely

02 §11 makes the frontend's compatibility controls release-gated on backend-published
artifacts. The failure that motivates *this* checker is not hypothetical: the
repository's stand-in metadata blob, `keeper/bleavit-keeper/tests/fixtures/
runtime-metadata.scale`, sat in the tree describing a runtime that no longer existed —
metadata **v14**, contract **v9**, 42 pallets, no `ClientRegistry`/`QuestionService`/
`ServiceLedger` — while the runtime moved to contract **v23**. It was wrong for eleven
days under fully green CI, and PLAN.md's F4 row still told the next session to bootstrap
descriptors from it.

Nothing caught it because every consumer was *internally consistent with the blob*. The
missing comparison was against the runtime source that had moved. That is the asymmetry
this file closes, and it is why the checks below read the **source**, never another
artifact derived from the same blob.

## Why it does not build or boot anything

The release-blocking leg (rebuild → re-extract → byte-diff) is the authority on whether
the committed feed reproduces. It costs ~2 h. A gate that expensive runs rarely, and the
defect above is exactly the kind that wants catching on *every* commit. Everything here
is a comparison against text and a pure-Python SCALE decode, so it costs a second — and
it would have caught the live defect on day one, by all four of its checks independently.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "release"))

from scale_metadata import (  # noqa: E402
    MetadataDecodeError,
    compare_layout,
    decode_metadata,
    surface_layout,
    surface_presence,
)

PRIMITIVES = REPO / "crates" / "futarchy-primitives" / "src" / "lib.rs"
RUNTIME_LIB = REPO / "runtime" / "bleavit-runtime" / "src" / "lib.rs"
MANIFEST = REPO / "tools" / "release" / "surface-manifest.json"

# 02 §12 fixes the `ReleaseChannel` raw key and its byte offsets precisely so a stranded
# reader needs no metadata; `system_properties` is an RPC, not a metadata item. Neither
# is metadata-resolvable, so `surface_presence` is the wrong instrument for them — the
# chainHead recorder checks both directly. Skipping them here is a statement about which
# tool owns the check, not an exemption.
NON_METADATA_KINDS = {"raw_storage", "properties"}

# Metadata v15 introduced the runtime-APIs section. Below it a blob cannot express a
# runtime API *at all*, so descriptors generated from one can serve none of 02 §3's
# frozen thirteen methods — the entire point of `packages/descriptors`. The stale blob
# was v14, which is why its 13 `FutarchyApi` failures were a format fact rather than
# staleness, and why a pallet-only check would have called it merely out of date.
MIN_METADATA_VERSION = 15


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")


def source_contract_version() -> int:
    text = PRIMITIVES.read_text(encoding="utf-8")
    match = re.search(
        r"pub const INTEGRATION_CONTRACT_VERSION:\s*u32\s*=\s*(\d+)\s*;", text
    )
    if not match:
        raise SystemExit(f"could not read INTEGRATION_CONTRACT_VERSION from {PRIMITIVES}")
    return int(match.group(1))


def source_pallets(profile_features: set[str]) -> set[str]:
    """Pallet names from `construct_runtime!`, honouring `#[cfg(feature = ...)]`.

    The gate must be feature-aware or it is simply wrong half the time: `Sudo` is
    declared behind `#[cfg(feature = "bootstrap")]`, so the lawful pallet set genuinely
    differs per runtime profile. A checker that ignored the attribute would demand Sudo
    of a release build and reject a correct feed.
    """
    text = RUNTIME_LIB.read_text(encoding="utf-8")
    block = re.search(r"construct_runtime!\(\s*pub enum Runtime \{(.*?)\n\s*\}\s*\);", text, re.S)
    if not block:
        raise SystemExit(f"could not locate construct_runtime! in {RUNTIME_LIB}")

    pallets: set[str] = set()
    pending_feature: str | None = None
    for raw in block.group(1).splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        cfg = re.match(r'#\[cfg\(feature\s*=\s*"([^"]+)"\)\]', line)
        if cfg:
            pending_feature = cfg.group(1)
            continue
        decl = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+=\s*\d+\s*,", line)
        if decl:
            if pending_feature is None or pending_feature in profile_features:
                pallets.add(decl.group(1))
            pending_feature = None
    return pallets


def check_feed(metadata_path: Path, info_path: Path | None, features: set[str]) -> int:
    problems = 0
    blob = metadata_path.read_bytes()
    try:
        md = decode_metadata(blob)
    except MetadataDecodeError as error:
        fail(f"{metadata_path} does not decode as runtime metadata: {error}")
        return 1

    expected_version = source_contract_version()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    # 1. Metadata version. Checked first: below v15 every runtime-API result downstream
    #    is a format artifact, and reporting 13 "missing" methods would misdescribe it.
    version = md["version"]
    if version < MIN_METADATA_VERSION:
        fail(
            f"metadata version {version} < {MIN_METADATA_VERSION}: this blob has no "
            "runtime-APIs section at all, so no descriptor generated from it can serve "
            "any of 02 §3's thirteen FutarchyApi methods"
        )
        problems += 1

    # 2. The contract version the blob declares vs the one the source declares.
    constant = md["pallets"].get("Constitution", {}).get("constants", {}).get(
        "INTEGRATION_CONTRACT_VERSION"
    )
    if constant is None:
        fail("Constitution::INTEGRATION_CONTRACT_VERSION absent from the feed metadata")
        problems += 1
    else:
        feed_version = int.from_bytes(constant["value"], "little")
        if feed_version != expected_version:
            fail(
                f"contract version drift: the feed declares v{feed_version}, "
                f"{PRIMITIVES.name} declares v{expected_version}"
            )
            problems += 1

    if manifest["integration_contract_version"] != expected_version:
        fail(
            f"surface-manifest.json is at v{manifest['integration_contract_version']} "
            f"but the source declares v{expected_version}"
        )
        problems += 1

    # 3. Pallet set vs construct_runtime!.
    feed_pallets = set(md["pallets"])
    expected_pallets = source_pallets(features)
    missing = sorted(expected_pallets - feed_pallets)
    extra = sorted(feed_pallets - expected_pallets)
    if missing:
        fail(f"pallets in construct_runtime! but absent from the feed: {', '.join(missing)}")
        problems += 1
    if extra:
        fail(f"pallets in the feed but absent from construct_runtime!: {', '.join(extra)}")
        problems += 1

    # 4. Every frozen surface entry, present and shaped as the manifest froze it.
    absent: list[str] = []
    mismatched: list[str] = []
    for entry in manifest["entries"]:
        if entry.get("kind") in NON_METADATA_KINDS:
            continue
        ok, detail = surface_presence(md, entry)
        if not ok:
            absent.append(f"{entry['id']}: {detail}")
            continue
        if "layout" in entry:
            ok, detail = compare_layout(surface_layout(md, entry), entry["layout"])
            if not ok:
                mismatched.append(f"{entry['id']}: {detail}")
    for label, rows in (("absent from the feed", absent), ("shaped differently", mismatched)):
        if rows:
            fail(f"{len(rows)} frozen surface entries {label}:")
            for row in rows[:10]:
                print(f"         {row}")
            if len(rows) > 10:
                print(f"         ... and {len(rows) - 10} more")
            problems += 1

    if info_path and info_path.is_file():
        info = json.loads(info_path.read_text(encoding="utf-8"))
        if sorted(info.get("metadata_pallets", [])) != sorted(feed_pallets):
            fail(f"{info_path.name} pallet list disagrees with {metadata_path.name}")
            problems += 1

    if problems == 0:
        print(
            f"OK  metadata v{version} · contract v{expected_version} · "
            f"{len(feed_pallets)} pallets · "
            f"{sum(1 for e in manifest['entries'] if e.get('kind') not in NON_METADATA_KINDS)}"
            " frozen surface entries verified"
        )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--runtime-info", type=Path, default=None)
    parser.add_argument(
        "--features",
        default="bootstrap",
        help="comma-separated cargo features the feed's runtime profile was built with",
    )
    args = parser.parse_args()
    features = {f.strip() for f in args.features.split(",") if f.strip()}
    return 1 if check_feed(args.metadata, args.runtime_info, features) else 0


if __name__ == "__main__":
    raise SystemExit(main())
