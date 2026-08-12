#!/usr/bin/env python3
"""Boot a release node and extract its SCALE metadata and runtime identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from node_boot import JsonRpcHttp, NodeProcess
from release_common import write_json
from rfc78 import metadata_hash
from runtime_profiles import RFC78_STATUS, validate_build_profile
from scale_metadata import MetadataDecodeError, decode_metadata

# Versions `scale_metadata.decode_metadata` can read. v16 exists and this runtime
# advertises it, but the decoder does not implement it yet; asking for a version we
# cannot decode would trade one unusable artifact for another.
SUPPORTED_METADATA = frozenset({15})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", type=Path, default=Path("target/release/bleavit-node"))
    parser.add_argument(
        "--chain-spec",
        type=Path,
        default=Path("deploy/chain-specs/out/bleavit-dev.json"),
    )
    parser.add_argument(
        "--wasm", type=Path, default=Path("release-work/runtime/runtime.wasm")
    )
    parser.add_argument("--out-dir", type=Path, default=Path("release-work/runtime"))
    parser.add_argument("--boot-timeout", type=float, default=120.0)
    parser.add_argument(
        "--embed-wasm",
        action="store_true",
        help="boot a temporary copy of the plain chain spec with --wasm as genesis :code",
    )
    return parser.parse_args()


def decode_compact(raw: bytes, offset: int = 0) -> tuple[int, int]:
    """SCALE compact integer -> (value, bytes consumed)."""
    first = raw[offset]
    mode = first & 0b11
    if mode == 0:
        return first >> 2, 1
    if mode == 1:
        return int.from_bytes(raw[offset : offset + 2], "little") >> 2, 2
    if mode == 2:
        return int.from_bytes(raw[offset : offset + 4], "little") >> 2, 4
    width = (first >> 2) + 4
    return int.from_bytes(raw[offset + 1 : offset + 1 + width], "little"), 1 + width


def fetch_metadata(rpc: JsonRpcHttp) -> tuple[bytes, int]:
    """Return the best metadata this runtime offers, and the version it is.

    `state_getMetadata` is the *legacy* RPC: it returns **v14** for backwards
    compatibility no matter what the runtime supports. v14 predates the
    runtime-APIs section entirely, so a v14 blob cannot describe a single one of
    [02](../../docs/architecture/02-integration-contract.md) §3's frozen thirteen
    `FutarchyApi` methods — and 02 §11 names this artifact as the input to
    *descriptor regeneration*. Publishing v14 therefore ships a metadata blob that
    is structurally incapable of serving the surface it exists to serve.

    Measured on this runtime (2026-08-03): `Metadata_metadata_versions` advertises
    **14, 15 and 16**, and the v15 blob carries 19 runtime APIs including
    `FutarchyApi`, while `state_getMetadata` returned v14 with zero.

    So ask for the newest version the toolchain can actually decode, and fail
    closed below v15 rather than silently emitting an unusable artifact.
    """
    offered: list[int] = []
    try:
        raw = decode_hex(
            rpc.call("state_call", ["Metadata_metadata_versions", "0x"]),
            "Metadata_metadata_versions",
        )
        count, consumed = decode_compact(raw)
        offered = [
            int.from_bytes(raw[consumed + i * 4 : consumed + i * 4 + 4], "little")
            for i in range(count)
        ]
    except Exception:  # noqa: BLE001 - a runtime without the API falls back below
        offered = []

    for version in sorted((v for v in offered if v in SUPPORTED_METADATA), reverse=True):
        blob = decode_hex(
            rpc.call(
                "state_call",
                ["Metadata_metadata_at_version", "0x" + version.to_bytes(4, "little").hex()],
            ),
            f"Metadata_metadata_at_version({version})",
        )
        if not blob or blob[0] != 1:
            continue  # Option::None - this runtime does not really serve it
        body = blob[1:]
        _, consumed = decode_compact(body)
        return body[consumed:], version

    raise RuntimeError(
        "runtime offers no metadata version this tooling supports "
        f"(advertised={offered or 'unknown'}, supported={sorted(SUPPORTED_METADATA)}). "
        "The legacy state_getMetadata blob is v14, which has no runtime-APIs section "
        "and cannot describe the frozen FutarchyApi (02 §3, §11)."
    )


def decode_hex(raw: str, label: str) -> bytes:
    if not isinstance(raw, str) or not raw.startswith("0x"):
        raise ValueError(f"{label} was not a 0x-prefixed hex string")
    try:
        return bytes.fromhex(raw[2:])
    except ValueError as error:
        raise ValueError(f"{label} contained invalid hex") from error


def bound_wasm_hashes(wasm_bytes: bytes, on_chain_hex: str) -> tuple[str, str]:
    """Return matching file/on-chain hashes or fail closed on the boot binding."""
    on_chain_wasm = decode_hex(on_chain_hex, "state_getStorage(:code)")
    file_hash = hashlib.sha256(wasm_bytes).hexdigest()
    on_chain_hash = hashlib.sha256(on_chain_wasm).hexdigest()
    if file_hash != on_chain_hash:
        raise RuntimeError(
            "booted runtime :code does not match --wasm: "
            f"file sha256={file_hash}, on-chain sha256={on_chain_hash}"
        )
    return file_hash, on_chain_hash


def compute_rfc78_metadata_hash(
    metadata_path: Path, build_info: dict[str, object]
) -> str:
    """Independently recompute RFC-78 over the extracted metadata artifact."""
    config = build_info["rfc78_metadata_hash"]
    assert isinstance(config, dict)  # validate_build_profile checked the exact shape
    return metadata_hash(
        metadata_path,
        str(config["token_symbol"]),
        int(config["token_decimals"]),
    )


def decode_embedded_rfc78_metadata_hash(raw_hex: str) -> str:
    """Decode `Option<[u8; 32]>` returned by the booted release-only API."""
    raw = decode_hex(raw_hex, "ReleaseMetadataApi_embedded_rfc78_metadata_hash")
    if len(raw) != 33 or raw[0] != 1:
        raise RuntimeError(
            "booted runtime did not expose one embedded RFC-78 digest; "
            "release profile may have omitted metadata-hash generation"
        )
    return "0x" + raw[1:].hex()


def main() -> int:
    args = parse_args()
    if not args.wasm.is_file():
        raise FileNotFoundError(f"runtime wasm not found: {args.wasm}")
    build_info_path = args.out_dir / "build-info.json"
    if not build_info_path.is_file():
        raise FileNotFoundError(
            f"profile-bound build information not found: {build_info_path}"
        )
    build_info = json.loads(build_info_path.read_text(encoding="utf-8"))
    build_errors = validate_build_profile(build_info)
    if build_errors:
        raise ValueError("invalid build profile: " + "; ".join(build_errors))
    wasm_bytes = args.wasm.read_bytes()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    chain_spec = args.chain_spec
    temporary_spec: tempfile.TemporaryDirectory[str] | None = None
    if args.embed_wasm:
        spec = json.loads(args.chain_spec.read_text(encoding="utf-8"))
        runtime_genesis = spec.get("genesis", {}).get("runtimeGenesis")
        if not isinstance(runtime_genesis, dict) or not isinstance(
            runtime_genesis.get("code"), str
        ):
            raise ValueError("--embed-wasm requires a plain runtimeGenesis chain spec")
        runtime_genesis["code"] = "0x" + wasm_bytes.hex()
        temporary_spec = tempfile.TemporaryDirectory()
        chain_spec = Path(temporary_spec.name) / args.chain_spec.name
        chain_spec.write_text(json.dumps(spec), encoding="utf-8")

    try:
        with NodeProcess(
            args.node, chain_spec, boot_timeout=args.boot_timeout
        ) as node:
            rpc = JsonRpcHttp(node.http_url)
            metadata, served_metadata_version = fetch_metadata(rpc)
            runtime_version = rpc.call("state_getRuntimeVersion")
            properties = rpc.call("system_properties")
            on_chain_code = rpc.call("state_getStorage", ["0x3a636f6465"])
            embedded_rfc78_metadata_hash = decode_embedded_rfc78_metadata_hash(
                rpc.call(
                    "state_call",
                    ["ReleaseMetadataApi_embedded_rfc78_metadata_hash", "0x"],
                )
            )
    finally:
        if temporary_spec is not None:
            temporary_spec.cleanup()

    wasm_file_sha256, on_chain_wasm_sha256 = bound_wasm_hashes(
        wasm_bytes, on_chain_code
    )

    metadata_path = args.out_dir / "metadata.scale"
    metadata_path.write_bytes(metadata)
    metadata_sha = hashlib.sha256(metadata).hexdigest()
    rfc78_metadata_hash = compute_rfc78_metadata_hash(metadata_path, build_info)
    if embedded_rfc78_metadata_hash != rfc78_metadata_hash:
        raise RuntimeError(
            "booted runtime embedded RFC-78 digest does not match independent "
            "metadata.scale recomputation: "
            f"embedded={embedded_rfc78_metadata_hash}, computed={rfc78_metadata_hash}"
        )

    contract_version = None
    contract_status = "not found in decoded metadata constants"
    metadata_version = None
    metadata_pallets: list[str] = []
    try:
        decoded = decode_metadata(metadata)
        metadata_version = decoded["version"]
        metadata_pallets = sorted(decoded["pallets"])
        constant = (
            decoded["pallets"]
            .get("Constitution", {})
            .get("constants", {})
            .get("INTEGRATION_CONTRACT_VERSION")
        )
        if constant is not None and len(constant["value"]) == 4:
            contract_version = int.from_bytes(constant["value"], "little")
            contract_status = "decoded from Constitution metadata constant"
    except MetadataDecodeError as error:
        contract_status = f"metadata decoder could not inspect constant: {error}"

    info = {
        "schema": "bleavit.runtime-info.v1",
        "runtime_profile": build_info["runtime_profile"],
        "metadata_pallets": metadata_pallets,
        "spec_name": runtime_version.get("specName"),
        "spec_version": runtime_version.get("specVersion"),
        "impl_name": runtime_version.get("implName"),
        "impl_version": runtime_version.get("implVersion"),
        "authoring_version": runtime_version.get("authoringVersion"),
        "transaction_version": runtime_version.get("transactionVersion"),
        "state_version": runtime_version.get("stateVersion"),
        "integration_contract_version": contract_version,
        "integration_contract_version_status": contract_status,
        "metadata_version": metadata_version,
        "metadata_sha256": metadata_sha,
        "metadata_hash_kind": "sha256-of-raw-scale-metadata",
        "rfc78_merkleized_metadata_hash": rfc78_metadata_hash,
        "embedded_rfc78_metadata_hash": embedded_rfc78_metadata_hash,
        "rfc78_status": RFC78_STATUS,
        "wasm_sha256": wasm_file_sha256,
        "wasm_file_sha256": wasm_file_sha256,
        "on_chain_wasm_sha256": on_chain_wasm_sha256,
        "system_properties": properties,
    }
    write_json(args.out_dir / "runtime-info.json", info)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
