#!/usr/bin/env python3
"""Build and validate the independently addressed release-credential index.

Release and attestation transaction IDs cannot live in ``release.json``: those
transactions exist only after the final document has been hashed and signed.
This small deterministic format binds the detached credential transaction IDs
back to those final bytes without creating that circular dependency.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "bleavit.release-credentials.v1"
TXID = re.compile(r"^[A-Za-z0-9_-]{43}$")
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


class CredentialIndexError(ValueError):
    """The credential index is malformed or does not bind to its release."""


@dataclass(frozen=True)
class CredentialIndex:
    release_json_sha256: str
    manifest_txid: str
    release_signature_txids: tuple[str, ...]
    attestation_txids: tuple[str, ...]


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CredentialIndexError(f"credential index duplicates key {key!r}")
        result[key] = value
    return result


def _txid_rows(value: Any, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) < 2:
        raise CredentialIndexError(f"credential index {field} must contain at least two entries")
    txids: list[str] = []
    for index, row in enumerate(value, 1):
        if not isinstance(row, dict) or set(row) != {"txid"}:
            raise CredentialIndexError(
                f"credential index {field}[{index}] must contain exactly txid"
            )
        txid = row["txid"]
        if not isinstance(txid, str) or TXID.fullmatch(txid) is None:
            raise CredentialIndexError(
                f"credential index {field}[{index}] has an invalid txid"
            )
        txids.append(txid)
    if len(set(txids)) != len(txids):
        raise CredentialIndexError(f"credential index {field} contains a duplicate txid")
    return tuple(txids)


def parse_credential_index(raw: bytes) -> CredentialIndex:
    try:
        document = json.loads(raw, object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CredentialIndexError(f"credential index is not valid JSON: {error}") from error
    if not isinstance(document, dict):
        raise CredentialIndexError("credential index must be a JSON object")
    expected = {
        "schema",
        "release_json_sha256",
        "manifest_txid",
        "release_signatures",
        "attestations",
    }
    if set(document) != expected:
        missing = sorted(expected - set(document))
        unexpected = sorted(set(document) - expected)
        detail = []
        if missing:
            detail.append("missing " + ", ".join(missing))
        if unexpected:
            detail.append("unexpected " + ", ".join(unexpected))
        raise CredentialIndexError("credential index fields differ: " + "; ".join(detail))
    if document["schema"] != SCHEMA:
        raise CredentialIndexError(f"credential index schema must be {SCHEMA}")
    digest = document["release_json_sha256"]
    if not isinstance(digest, str) or SHA256_HEX.fullmatch(digest) is None:
        raise CredentialIndexError("credential index release_json_sha256 is invalid")
    manifest_txid = document["manifest_txid"]
    if not isinstance(manifest_txid, str) or TXID.fullmatch(manifest_txid) is None:
        raise CredentialIndexError("credential index manifest_txid is invalid")
    release_txids = _txid_rows(document["release_signatures"], "release_signatures")
    attestation_txids = _txid_rows(document["attestations"], "attestations")
    overlap = set(release_txids) & set(attestation_txids)
    if overlap:
        raise CredentialIndexError(
            "credential index reuses a transaction across credential roles"
        )
    return CredentialIndex(
        digest,
        manifest_txid,
        release_txids,
        attestation_txids,
    )


def build_credential_index(
    release_json: bytes,
    release_signature_txids: Iterable[str],
    attestation_txids: Iterable[str],
) -> bytes:
    try:
        release_document = json.loads(release_json)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CredentialIndexError(f"release.json is not valid JSON: {error}") from error
    manifest_txid = (
        release_document.get("manifest_txid")
        if isinstance(release_document, dict)
        else None
    )
    document = {
        "schema": SCHEMA,
        "release_json_sha256": hashlib.sha256(release_json).hexdigest(),
        "manifest_txid": manifest_txid,
        "release_signatures": [{"txid": value} for value in release_signature_txids],
        "attestations": [{"txid": value} for value in attestation_txids],
    }
    encoded = (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()
    # The parser is the format authority. Running produced bytes back through it
    # prevents the producer and unattended consumer from acquiring two schemas.
    parse_credential_index(encoded)
    return encoded


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the deterministic Bleavit release credential index."
    )
    parser.add_argument("--release-json", type=Path, required=True)
    parser.add_argument("--release-signature", action="append", required=True)
    parser.add_argument("--attestation", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        encoded = build_credential_index(
            args.release_json.read_bytes(),
            args.release_signature,
            args.attestation,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    except (OSError, CredentialIndexError) as error:
        raise SystemExit(str(error)) from error
    print(f"credential_index_sha256={hashlib.sha256(encoded).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
