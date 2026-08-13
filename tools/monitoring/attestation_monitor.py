#!/usr/bin/env python3
"""Out-of-band Bleavit release attestation monitor (12 section 5.2).

The live fetcher consumes the same ``bleavit.app-release.v1`` document emitted
by ``app/tools/release``.  That document pins the asset-only manifest M in
``arweaveManifestTxId``; the independently provisioned credential index, ArNS,
and ``ReleaseChannel`` bind the distinct final manifest M-prime that adds
``release.json``.  Keeping those two addresses separate avoids both the
self-addressing cycle and a verifier that checks a tree no browser loads.

The production module is verify-only.  Tests contain their own deterministic
signer solely to produce RFC/minisign-format fixtures.
"""

from __future__ import annotations

import argparse
import base64
import collections
import hashlib
import ipaddress
import json
import logging
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

try:
    import tomllib
except ModuleNotFoundError:  # Local gate compatibility; production is Python 3.12.
    import toml_compat as tomllib  # type: ignore[no-redef]

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    MetricStore,
    MonitoringError,
    RELEASE_CHANNEL_KEY,
    ReleaseChannel,
    SeriesDefinition,
    WsRpc,
    decode_release_channel,
    header_number,
    hex_bytes,
    serve_metrics,
)
from credential_index import (  # noqa: E402
    CredentialIndex,
    CredentialIndexError,
    parse_credential_index,
)


LOG = logging.getLogger("bleavit-attestation-monitor")
APP_RELEASE_SCHEMA = "bleavit.app-release.v1"
TXID = re.compile(r"^[A-Za-z0-9_-]{43}$")
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
HASH32_HEX = re.compile(r"^0x[0-9a-f]{64}$")
STABLE_IDENTIFIER = re.compile(r"^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$")


def _stable_identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or STABLE_IDENTIFIER.fullmatch(value) is None:
        raise MonitoringError(
            f"{label} must be a lowercase stable identifier using a-z, 0-9, dot, dash, or underscore"
        )
    return value


def _series(name: str, kind: str, help_text: str) -> SeriesDefinition:
    return SeriesDefinition(name, kind, help_text)


SERIES: dict[str, SeriesDefinition] = {
    item.name: item
    for item in (
        _series("bleavit_release_monitor_up", "gauge", "Whether the last complete out-of-band check ran."),
        _series("bleavit_release_monitor_checks_total", "counter", "Completed out-of-band checks."),
        _series("bleavit_release_monitor_errors_total", "counter", "Operational/configuration check failures."),
        _series("bleavit_release_monitor_last_check_timestamp_seconds", "gauge", "Unix time of the last check attempt."),
        _series("bleavit_release_monitor_integrity_ok", "gauge", "Whether every release-integrity predicate passed."),
        _series("bleavit_release_monitor_bundle_byte_mismatches", "gauge", "Files/routes whose bytes differ from the signed map."),
        _series("bleavit_release_monitor_resolver_divergent_gateways", "gauge", "Gateway resolutions differing from ReleaseChannel manifest_txid."),
        _series("bleavit_release_monitor_valid_release_signatures", "gauge", "Valid non-revoked release signatures."),
        _series("bleavit_release_monitor_valid_attestations", "gauge", "Organizations represented by valid non-revoked attestor signatures."),
        _series("bleavit_release_monitor_keyring_generation", "gauge", "Verified release keyring generation."),
        _series("bleavit_release_monitor_manifest_matches_channel", "gauge", "Whether every resolved final manifest matches ReleaseChannel."),
        _series("bleavit_release_monitor_covering_release", "gauge", "Whether the canonical release covers ReleaseChannel spec_version."),
        _series("bleavit_release_monitor_repoint_channel_lag_blocks", "gauge", "Observed finalized blocks since an ArNS target first differed from ReleaseChannel."),
        _series("bleavit_release_monitor_ant_record_changes_total", "counter", "Observed majority ArNS target changes."),
        _series("bleavit_release_monitor_webhook_failures_total", "counter", "Failed release-integrity webhook POSTs."),
    )
}


# RFC 8032 Ed25519 verification -------------------------------------------------
Q = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, Q - 2, Q)) % Q
I = pow(2, (Q - 1) // 4, Q)
B_Y = (4 * pow(5, Q - 2, Q)) % Q


def _recover_x(y: int, sign: int) -> int:
    if y >= Q:
        raise ValueError("Ed25519 y coordinate is out of range")
    xx = ((y * y - 1) * pow(D * y * y + 1, Q - 2, Q)) % Q
    x = pow(xx, (Q + 3) // 8, Q)
    if (x * x - xx) % Q:
        x = (x * I) % Q
    if (x * x - xx) % Q:
        raise ValueError("Ed25519 point is not on the curve")
    if x & 1 != sign:
        x = Q - x
    return x


B_X = _recover_x(B_Y, 0)
B = (B_X, B_Y, 1, (B_X * B_Y) % Q)
IDENTITY = (0, 1, 1, 0)


def _point_add(p: tuple[int, int, int, int], q: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = ((y1 - x1) * (y2 - x2)) % Q
    b = ((y1 + x1) * (y2 + x2)) % Q
    c = (2 * D * t1 * t2) % Q
    d = (2 * z1 * z2) % Q
    e = (b - a) % Q
    f = (d - c) % Q
    g = (d + c) % Q
    h = (b + a) % Q
    return (e * f % Q, g * h % Q, f * g % Q, e * h % Q)


def _scalar_mult(point: tuple[int, int, int, int], scalar: int) -> tuple[int, int, int, int]:
    result = IDENTITY
    addend = point
    while scalar:
        if scalar & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        scalar >>= 1
    return result


def _decode_point(encoded: bytes) -> tuple[int, int, int, int]:
    if len(encoded) != 32:
        raise ValueError("Ed25519 point must be 32 bytes")
    value = int.from_bytes(encoded, "little")
    y = value & ((1 << 255) - 1)
    x = _recover_x(y, value >> 255)
    point = (x, y, 1, x * y % Q)
    # Reject small-order points; they cannot represent a signing identity.
    #
    # The comparison MUST be projective. Points are extended coordinates
    # (X, Y, Z, T) and `8*P` for a small-order P lands on a non-normalized
    # representative of the identity — (0, k, k, 0) for some k != 1 — which is
    # mathematically IDENTITY but never tuple-equal to it. A `==` here therefore
    # accepted every small-order point, including all four canonical ones, and
    # the "strict RFC 8032" claim this module makes did not hold
    # (audit 2026-07-27, AUD-2).
    if _points_equal(_scalar_mult(point, 8), IDENTITY):
        raise ValueError("Ed25519 small-order point is rejected")
    return point


def _points_equal(p: tuple[int, int, int, int], q: tuple[int, int, int, int]) -> bool:
    return (p[0] * q[2] - q[0] * p[2]) % Q == 0 and (
        p[1] * q[2] - q[1] * p[2]
    ) % Q == 0


def ed25519_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Strict RFC 8032 Ed25519 verification using Python integers only."""
    if len(public_key) != 32 or len(signature) != 64:
        return False
    try:
        a = _decode_point(public_key)
        r = _decode_point(signature[:32])
    except ValueError:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    h = int.from_bytes(
        hashlib.sha512(signature[:32] + public_key + message).digest(), "little"
    ) % L
    return _points_equal(_scalar_mult(B, s), _point_add(r, _scalar_mult(a, h)))


# Minisign parsing -------------------------------------------------------------
@dataclass(frozen=True)
class MinisignPublicKey:
    key_id: bytes
    public_key: bytes


@dataclass(frozen=True)
class MinisignSignature:
    algorithm: bytes
    key_id: bytes
    signature: bytes
    trusted_comment: str
    global_signature: bytes


def _b64(line: str, label: str) -> bytes:
    try:
        return base64.b64decode(line, validate=True)
    except ValueError as error:
        raise ValueError(f"invalid base64 in minisign {label}") from error


def parse_minisign_public_key(text: str) -> MinisignPublicKey:
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if len(lines) == 1:
        encoded = lines[0]
    elif len(lines) == 2 and lines[0].startswith("untrusted comment:"):
        encoded = lines[1]
    else:
        raise ValueError("minisign public key must contain comment + base64 packet")
    packet = _b64(encoded, "public key")
    if len(packet) != 42 or packet[:2] != b"Ed":
        raise ValueError("minisign public key packet must be Ed + 8-byte id + 32-byte key")
    return MinisignPublicKey(packet[2:10], packet[10:42])


def parse_minisign_signature(text: str) -> MinisignSignature:
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if len(lines) != 4 or not lines[0].startswith("untrusted comment:"):
        raise ValueError("minisign signature must contain exactly four non-empty lines")
    prefixes = ("trusted comment:", "trusted_comment:")
    prefix = next((candidate for candidate in prefixes if lines[2].startswith(candidate)), None)
    if prefix is None:
        raise ValueError("minisign signature has no trusted comment line")
    packet = _b64(lines[1], "signature")
    global_signature = _b64(lines[3], "global signature")
    if len(packet) != 74 or packet[:2] not in (b"Ed", b"ED"):
        raise ValueError("minisign packet must be Ed/ED + 8-byte id + 64-byte signature")
    if len(global_signature) != 64:
        raise ValueError("minisign global signature must be 64 bytes")
    return MinisignSignature(
        algorithm=packet[:2],
        key_id=packet[2:10],
        signature=packet[10:74],
        trusted_comment=lines[2][len(prefix) :].lstrip(),
        global_signature=global_signature,
    )


def verify_minisign(message: bytes, signature_text: str, public: MinisignPublicKey) -> bool:
    try:
        signature = parse_minisign_signature(signature_text)
    except ValueError:
        return False
    if signature.key_id != public.key_id:
        return False
    signed_message = (
        message
        if signature.algorithm == b"Ed"
        else hashlib.blake2b(message, digest_size=64).digest()
    )
    if not ed25519_verify(public.public_key, signed_message, signature.signature):
        return False
    # Minisign's global signature binds the 64-byte primary signature to the
    # trusted-comment payload (the algorithm/id are already bound by key lookup).
    return ed25519_verify(
        public.public_key,
        signature.signature + signature.trusted_comment.encode("utf-8"),
        signature.global_signature,
    )


@dataclass(frozen=True)
class KeyRecord:
    key_id: bytes
    public_key: MinisignPublicKey
    role: str
    revocation_index: int
    organization: str


@dataclass(frozen=True)
class Keyring:
    generation: int
    keys: Mapping[bytes, KeyRecord]


def load_keyring(path: Path) -> Keyring:
    try:
        with path.open("rb") as handle:
            document = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise MonitoringError(f"cannot load keyring {path}: {error}") from error
    generation = document.get("generation")
    rows = document.get("key")
    if not isinstance(generation, int) or generation < 0:
        raise MonitoringError("keyring generation must be a non-negative integer")
    if not isinstance(rows, list) or not rows:
        raise MonitoringError("keyring must contain at least one [[key]]")
    keys: dict[bytes, KeyRecord] = {}
    indexes: set[int] = set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise MonitoringError(f"keyring entry {index} must be a table")
        expected_fields = {"role", "revocation_index", "public_key", "organization"}
        if set(row) != expected_fields:
            raise MonitoringError(
                f"keyring entry {index} must contain exactly "
                "role, revocation_index, public_key, organization"
            )
        role = row.get("role")
        revocation_index = row.get("revocation_index")
        encoded = row.get("public_key")
        organization = row.get("organization")
        if role not in {"release", "attestor"}:
            raise MonitoringError(f"keyring entry {index} role must be release or attestor")
        if not isinstance(revocation_index, int) or not 0 <= revocation_index < 64:
            raise MonitoringError(f"keyring entry {index} revocation_index must be 0..63")
        if revocation_index in indexes:
            raise MonitoringError(f"keyring revocation_index {revocation_index} is duplicated")
        if not isinstance(encoded, str):
            raise MonitoringError(f"keyring entry {index} public_key must be a string")
        organization = _stable_identifier(
            organization, f"keyring entry {index} organization"
        )
        try:
            public = parse_minisign_public_key(encoded)
        except ValueError as error:
            raise MonitoringError(f"keyring entry {index}: {error}") from error
        if public.key_id in keys:
            raise MonitoringError(f"keyring key id {public.key_id.hex()} is duplicated")
        indexes.add(revocation_index)
        keys[public.key_id] = KeyRecord(
            public.key_id, public, role, revocation_index, organization
        )
    return Keyring(generation, keys)


@dataclass(frozen=True)
class IntegrityVerdict:
    ok: bool
    errors: tuple[str, ...]
    byte_mismatches: int
    resolver_divergent_gateways: int
    valid_release_signatures: int
    valid_attestations: int
    manifest_matches_channel: bool
    covering_release: bool


@dataclass(frozen=True)
class AppRelease:
    asset_manifest_txid: str
    per_file_hashes: Mapping[str, str]
    primary_spec_version: int
    recovery_spec_version: int
    keyring_generation: int


def _u32(value: Any, label: str) -> int:
    if type(value) is not int or not 0 <= value <= 0xFFFF_FFFF:
        raise MonitoringError(f"release.json {label} must be a u32")
    return value


def _release_path(value: Any) -> str:
    segments = value.split("/") if isinstance(value, str) else ()
    if (
        not isinstance(value, str)
        or not value
        or re.fullmatch(r"[A-Za-z0-9._/-]+", value) is None
        or value.startswith("/")
        or any(segment in {"", ".", ".."} for segment in segments)
    ):
        raise MonitoringError("release.json perFileHashes contains an unsafe path")
    return value


def parse_app_release(document: Any) -> AppRelease:
    """Project the canonical app-v1 release fields used by the monitor."""
    if not isinstance(document, dict) or document.get("schema") != APP_RELEASE_SCHEMA:
        raise MonitoringError(f"release.json must use schema {APP_RELEASE_SCHEMA}")
    asset_manifest_txid = document.get("arweaveManifestTxId")
    if not isinstance(asset_manifest_txid, str) or TXID.fullmatch(
        asset_manifest_txid
    ) is None:
        raise MonitoringError(
            "release.json arweaveManifestTxId must be a published Arweave transaction id"
        )
    raw_hashes = document.get("perFileHashes")
    if not isinstance(raw_hashes, dict) or not raw_hashes:
        raise MonitoringError("release.json perFileHashes must be a non-empty object")
    hashes: dict[str, str] = {}
    for raw_path, digest in raw_hashes.items():
        path = _release_path(raw_path)
        if path == "release.json":
            raise MonitoringError(
                "release.json cannot hash itself in perFileHashes"
            )
        if not isinstance(digest, str) or SHA256_HEX.fullmatch(digest) is None:
            raise MonitoringError(
                f"release.json perFileHashes[{path!r}] is not lowercase SHA-256 hex"
            )
        hashes[path] = digest
    raw_range = document.get("specVersionRange")
    if not isinstance(raw_range, dict):
        raise MonitoringError("release.json specVersionRange must be an object")
    primary = _u32(raw_range.get("primary"), "specVersionRange.primary")
    recovery = _u32(raw_range.get("recovery"), "specVersionRange.recovery")
    if recovery != primary + 1:
        raise MonitoringError(
            "release.json recovery spec version must equal primary + 1"
        )
    generation = _u32(document.get("keyringGeneration"), "keyringGeneration")
    readiness = document.get("readiness")
    if not isinstance(readiness, dict) or readiness.get("productionReady") is not True:
        raise MonitoringError("release.json is not marked production ready")
    return AppRelease(
        asset_manifest_txid,
        hashes,
        primary,
        recovery,
        generation,
    )


def _valid_signers(
    message: bytes,
    blobs: Sequence[str],
    keyring: Keyring,
    channel: ReleaseChannel,
    role: str,
) -> dict[bytes, KeyRecord]:
    valid: dict[bytes, KeyRecord] = {}
    for blob in blobs:
        try:
            signature = parse_minisign_signature(blob)
        except ValueError:
            continue
        record = keyring.keys.get(signature.key_id)
        if record is None or record.role != role:
            continue
        if channel.revoked_key_bits & (1 << record.revocation_index):
            continue
        if verify_minisign(message, blob, record.public_key):
            valid[record.key_id] = record
    return valid


def evaluate_integrity(
    *,
    files: Mapping[str, bytes],
    expected_hashes: Mapping[str, str],
    release_json_bytes: bytes,
    release_document: Mapping[str, Any],
    release_signatures: Sequence[str],
    attestations: Sequence[str],
    keyring: Keyring,
    release_channel_bytes: bytes,
    resolved_txids: Sequence[str],
    minimum_release_signatures: int,
) -> IntegrityVerdict:
    """Format-agnostic comparison core used by live fetching and tamper tests."""
    channel = decode_release_channel(release_channel_bytes)
    release = parse_app_release(release_document)
    errors: list[str] = []
    mismatches = 0
    for path, expected in sorted(expected_hashes.items()):
        value = files.get(path)
        if value is None or SHA256_HEX.fullmatch(expected) is None or hashlib.sha256(value).hexdigest() != expected:
            mismatches += 1
            errors.append(f"byte/hash mismatch: {path}")
    unexpected = sorted(set(files) - set(expected_hashes))
    if unexpected:
        mismatches += len(unexpected)
        errors.append("unlisted served files: " + ", ".join(unexpected))

    if release.asset_manifest_txid == channel.manifest_txid:
        errors.append(
            "release.json asset manifest equals the final ReleaseChannel manifest"
        )
    if hashlib.sha256(release_json_bytes).digest() != channel.release_json_hash:
        errors.append("release.json SHA-256 differs from ReleaseChannel")

    divergent = sum(txid != channel.manifest_txid for txid in resolved_txids)
    manifest_matches = bool(resolved_txids) and divergent == 0
    if divergent:
        errors.append(f"{divergent}-of-{len(resolved_txids)} gateway resolvers diverge")

    generation = release.keyring_generation
    if generation != channel.keyring_generation or generation != keyring.generation:
        errors.append("release/keyring/ReleaseChannel generation mismatch")

    # 12 section 2.1 says release keys sign release.json's SHA-256 hash.
    signed_message = hashlib.sha256(release_json_bytes).digest()
    release_keys = _valid_signers(
        signed_message, release_signatures, keyring, channel, "release"
    )
    attestor_keys = _valid_signers(
        signed_message, attestations, keyring, channel, "attestor"
    )
    attestor_organizations = {record.organization for record in attestor_keys.values()}
    if len(release_keys) < minimum_release_signatures:
        errors.append(
            f"valid release signatures {len(release_keys)} < operator minimum {minimum_release_signatures}"
        )
    if len(attestor_organizations) < 2:
        errors.append(
            "valid independent attestation organizations "
            f"{len(attestor_organizations)} < 2"
        )

    covering = channel.spec_version in {
        release.primary_spec_version,
        release.recovery_spec_version,
    }
    if not covering:
        errors.append("canonical release does not cover ReleaseChannel spec_version")
    return IntegrityVerdict(
        not errors,
        tuple(errors),
        mismatches,
        divergent,
        len(release_keys),
        len(attestor_organizations),
        manifest_matches,
        covering,
    )


# Configuration and live fetching ---------------------------------------------
@dataclass(frozen=True)
class Gateway:
    name: str
    operator: str
    resolve_url: str
    raw_url: str
    tx_url: str
    name_url: str
    tx_root_url: str
    name_root_url: str


@dataclass(frozen=True)
class RpcEndpoint:
    operator: str
    url: str


@dataclass(frozen=True)
class Config:
    gateways: tuple[Gateway, ...]
    rpc_endpoints: tuple[RpcEndpoint, ...]
    expected_genesis_hash: str
    credential_index_txid: str
    credential_index_sha256: str
    arns_name: str
    keyring_file: Path
    bind: str
    check_interval_seconds: int
    rpc_poll_interval_seconds: int
    minimum_release_signatures: int
    max_file_bytes: int
    max_bundle_bytes: int
    webhooks: Mapping[str, tuple[str, ...]]


def _normalized_origin(value: str, label: str, schemes: set[str]) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise MonitoringError(f"{label} is not a valid URL: {error}") from error
    if parsed.scheme not in schemes or parsed.hostname is None:
        raise MonitoringError(
            f"{label} must use one of {', '.join(sorted(schemes))} and include a host"
        )
    if parsed.username is not None or parsed.password is not None:
        raise MonitoringError(f"{label} must not contain URL userinfo")
    raw_host = parsed.hostname.rstrip(".")
    if not raw_host:
        raise MonitoringError(f"{label} has an empty host")
    try:
        host = ipaddress.ip_address(raw_host).compressed
    except ValueError:
        try:
            host = raw_host.encode("idna").decode("ascii").lower()
        except UnicodeError as error:
            raise MonitoringError(f"{label} has an invalid internationalized host") from error
        labels = host.split(".")
        if any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
            for part in labels
        ):
            raise MonitoringError(f"{label} has an invalid DNS host")
    if port is None:
        port = 443 if parsed.scheme in {"https", "wss"} else 80
    rendered_host = f"[{host}]" if ":" in host else host
    return f"{parsed.scheme}://{rendered_host}:{port}"


def _template(value: Any, label: str, fields: Iterable[str]) -> str:
    if not isinstance(value, str):
        raise MonitoringError(f"{label} must be an https:// URL template")
    expected_fields = set(fields)
    actual_fields = re.findall(r"{([^{}]+)}", value)
    if (
        value.count("{") != len(actual_fields)
        or value.count("}") != len(actual_fields)
        or set(actual_fields) != expected_fields
    ):
        raise MonitoringError(
            f"{label} placeholders must be exactly: {', '.join(sorted(expected_fields))}"
        )
    parsed = urllib.parse.urlsplit(value)
    origin_probe = value
    for field, replacement in {
        "name": "origin-check",
        "txid": "A" * 43,
        "path": "origin-check",
    }.items():
        origin_probe = origin_probe.replace("{" + field + "}", replacement)
    _normalized_origin(origin_probe, label, {"https"})
    if parsed.query or parsed.fragment:
        raise MonitoringError(f"{label} must not contain a query or fragment")
    for field in ("txid", "path"):
        if "{" + field + "}" in parsed.netloc:
            raise MonitoringError(
                f"{label} must keep the dynamic {field} placeholder outside the URL authority"
            )
    return value


def _rpc_url(value: Any, label: str) -> tuple[str, str]:
    if not isinstance(value, str):
        raise MonitoringError(f"{label} must be a ws:// or wss:// URL")
    origin = _normalized_origin(value, label, {"ws", "wss"})
    parsed = urllib.parse.urlsplit(value)
    if parsed.query or parsed.fragment:
        raise MonitoringError(f"{label} must not contain a query or fragment")
    if parsed.scheme == "ws":
        host = parsed.hostname or ""
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = host.lower().rstrip(".") == "localhost"
        if not loopback:
            raise MonitoringError(f"{label} may use plaintext ws:// only on loopback")
    return value, origin


def load_config(path: Path) -> Config:
    try:
        with path.open("rb") as handle:
            document = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise MonitoringError(f"cannot load config {path}: {error}") from error
    monitor = document.get("monitor")
    gateway_rows = document.get("gateway")
    rpc_rows = document.get("rpc")
    webhooks = document.get("webhooks")
    if not isinstance(monitor, dict):
        raise MonitoringError("config requires [monitor]")
    monitor_fields = {
        "expected_genesis_hash",
        "credential_index_txid",
        "credential_index_sha256",
        "arns_name",
        "keyring_file",
        "bind",
        "check_interval_seconds",
        "rpc_poll_interval_seconds",
        "minimum_release_signatures",
        "max_file_bytes",
        "max_bundle_bytes",
    }
    missing_monitor_fields = sorted(monitor_fields - set(monitor))
    unexpected_monitor_fields = sorted(set(monitor) - monitor_fields)
    if missing_monitor_fields:
        raise MonitoringError(
            "monitor configuration is missing operator-supplied fields: "
            + ", ".join(missing_monitor_fields)
        )
    if unexpected_monitor_fields:
        raise MonitoringError(
            "monitor configuration contains undocumented fields: "
            + ", ".join(unexpected_monitor_fields)
        )
    arns_name = monitor.get("arns_name")
    if not isinstance(arns_name, str) or not re.fullmatch(r"[a-z0-9_-]+", arns_name):
        raise MonitoringError("monitor.arns_name must contain lowercase ArNS name characters")
    if not isinstance(gateway_rows, list) or len(gateway_rows) < 3:
        raise MonitoringError("config requires at least three [[gateway]] entries")
    names: set[str] = set()
    gateway_operators: set[str] = set()
    gateway_origins: set[str] = set()
    gateways: list[Gateway] = []
    for index, row in enumerate(gateway_rows, 1):
        if not isinstance(row, dict) or set(row) != {
            "name",
            "operator",
            "resolve_url",
            "raw_url",
            "tx_url",
            "name_url",
            "tx_root_url",
            "name_root_url",
        }:
            raise MonitoringError(f"gateway {index} must contain exactly the documented fields")
        name = _stable_identifier(row.get("name"), f"gateway {index} name")
        operator = _stable_identifier(row.get("operator"), f"gateway {index} operator")
        if name in names:
            raise MonitoringError(f"gateway name {name!r} is duplicated")
        if operator in gateway_operators:
            raise MonitoringError(f"gateway operator {operator!r} is duplicated")
        urls = (
            _template(row.get("resolve_url"), f"gateway {name} resolve_url", ("name",)),
            _template(row.get("raw_url"), f"gateway {name} raw_url", ("txid",)),
            _template(row.get("tx_url"), f"gateway {name} tx_url", ("txid", "path")),
            _template(row.get("name_url"), f"gateway {name} name_url", ("name", "path")),
            _template(row.get("tx_root_url"), f"gateway {name} tx_root_url", ("txid",)),
            _template(row.get("name_root_url"), f"gateway {name} name_root_url", ("name",)),
        )
        origins = {
            _normalized_origin(
                _format_url(
                    url,
                    name=arns_name,
                    txid="A" * 43,
                    path="origin-check",
                ),
                f"gateway {name} URL",
                {"https"},
            )
            for url in urls
        }
        overlap = origins & gateway_origins
        if overlap:
            raise MonitoringError(
                f"gateway {name} reuses normalized origin {sorted(overlap)[0]}"
            )
        names.add(name)
        gateway_operators.add(operator)
        gateway_origins.update(origins)
        gateways.append(
            Gateway(
                name,
                operator,
                *urls,
            )
        )
    if not isinstance(rpc_rows, list) or len(rpc_rows) < 3:
        raise MonitoringError("config requires at least three [[rpc]] entries")
    rpc_operators: set[str] = set()
    rpc_origins: set[str] = set()
    rpc_endpoints: list[RpcEndpoint] = []
    for index, row in enumerate(rpc_rows, 1):
        if not isinstance(row, dict) or set(row) != {"operator", "url"}:
            raise MonitoringError(f"rpc {index} must contain exactly operator and url")
        operator = _stable_identifier(row.get("operator"), f"rpc {index} operator")
        url, origin = _rpc_url(row.get("url"), f"rpc {operator} url")
        if operator in rpc_operators:
            raise MonitoringError(f"rpc operator {operator!r} is duplicated")
        if origin in rpc_origins:
            raise MonitoringError(f"rpc normalized origin {origin} is duplicated")
        rpc_operators.add(operator)
        rpc_origins.add(origin)
        rpc_endpoints.append(RpcEndpoint(operator, url))
    expected_genesis_hash = monitor.get("expected_genesis_hash")
    if not isinstance(expected_genesis_hash, str) or HASH32_HEX.fullmatch(expected_genesis_hash) is None:
        raise MonitoringError("monitor.expected_genesis_hash must be 32-byte lowercase 0x hex")
    if expected_genesis_hash == "0x" + "0" * 64:
        raise MonitoringError("monitor.expected_genesis_hash must not be the all-zero placeholder")
    credential_index_txid = monitor.get("credential_index_txid")
    if not isinstance(credential_index_txid, str) or TXID.fullmatch(credential_index_txid) is None:
        raise MonitoringError("monitor.credential_index_txid must be an Arweave transaction id")
    credential_index_sha256 = monitor.get("credential_index_sha256")
    if not isinstance(credential_index_sha256, str) or SHA256_HEX.fullmatch(credential_index_sha256) is None:
        raise MonitoringError("monitor.credential_index_sha256 must be lowercase SHA-256 hex")
    if credential_index_sha256 == "0" * 64:
        raise MonitoringError("monitor.credential_index_sha256 must not be the all-zero placeholder")
    bind = monitor.get("bind")
    interval = monitor.get("check_interval_seconds")
    rpc_poll_interval = monitor.get("rpc_poll_interval_seconds")
    minimum = monitor.get("minimum_release_signatures")
    max_file = monitor.get("max_file_bytes")
    max_bundle = monitor.get("max_bundle_bytes")
    if not isinstance(bind, str):
        raise MonitoringError("monitor.bind must be HOST:PORT")
    if not isinstance(interval, int) or not 1 <= interval <= 3600:
        raise MonitoringError("monitor.check_interval_seconds must be 1..3600 (hourly floor)")
    if (
        not isinstance(rpc_poll_interval, int)
        or rpc_poll_interval < 1
        or rpc_poll_interval > interval
    ):
        raise MonitoringError(
            "monitor.rpc_poll_interval_seconds must be 1..check_interval_seconds"
        )
    if not isinstance(minimum, int) or minimum < 2:
        raise MonitoringError(
            "monitor.minimum_release_signatures must be operator-supplied and >= 2 "
            "(12 §1.4 release-signature floor)"
        )
    if not isinstance(max_file, int) or max_file <= 0:
        raise MonitoringError("monitor.max_file_bytes must be operator-supplied and positive")
    if not isinstance(max_bundle, int) or max_bundle < max_file:
        raise MonitoringError("monitor.max_bundle_bytes must be >= max_file_bytes")
    keyring_value = monitor.get("keyring_file")
    if not isinstance(keyring_value, str) or not keyring_value:
        raise MonitoringError("monitor.keyring_file must be a path")
    keyring_file = Path(keyring_value)
    if not keyring_file.is_absolute():
        keyring_file = path.parent / keyring_file
    if not isinstance(webhooks, dict):
        raise MonitoringError("config requires [webhooks]")
    if set(webhooks) != {"paging", "status_page", "community"}:
        raise MonitoringError("webhooks must contain exactly paging, status_page, community")
    parsed_webhooks: dict[str, tuple[str, ...]] = {}
    for channel in ("paging", "status_page", "community"):
        values = webhooks.get(channel)
        if not isinstance(values, list) or not values or not all(
            isinstance(value, str) for value in values
        ):
            raise MonitoringError(f"webhooks.{channel} must be a non-empty https:// URL list")
        for index, value in enumerate(values, 1):
            _normalized_origin(value, f"webhooks.{channel}[{index}]", {"https"})
        parsed_webhooks[channel] = tuple(values)
    return Config(
        tuple(gateways),
        tuple(rpc_endpoints),
        expected_genesis_hash,
        credential_index_txid,
        credential_index_sha256,
        arns_name,
        keyring_file,
        bind,
        interval,
        rpc_poll_interval,
        minimum,
        max_file,
        max_bundle,
        parsed_webhooks,
    )


class Fetcher:
    def __init__(self, config: Config):
        self.config = config
        self.total = 0

    def get(self, url: str, *, json_value: bool = False) -> Any:
        request = urllib.request.Request(
            url,
            headers={"Cache-Control": "no-cache, no-store", "Pragma": "no-cache", "User-Agent": "bleavit-attestation-monitor/1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                length = response.headers.get("Content-Length")
                if length is not None and int(length) > self.config.max_file_bytes:
                    raise MonitoringError(f"response exceeds operator max_file_bytes: {url}")
                value = response.read(self.config.max_file_bytes + 1)
        except (OSError, urllib.error.URLError, ValueError) as error:
            raise MonitoringError(f"fetch failed for {url}: {error}") from error
        if len(value) > self.config.max_file_bytes:
            raise MonitoringError(f"response exceeds operator max_file_bytes: {url}")
        self.total += len(value)
        if self.total > self.config.max_bundle_bytes:
            raise MonitoringError("fetch exceeds operator max_bundle_bytes")
        if not json_value:
            return value
        try:
            return json.loads(value)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise MonitoringError(f"non-JSON response from {url}") from error


def _format_url(template: str, **values: str) -> str:
    return template.format(
        **{
            key: urllib.parse.quote(value, safe="/" if key == "path" else "")
            for key, value in values.items()
        }
    )


def resolve_arns(config: Config, fetcher: Fetcher | None = None) -> list[str]:
    """Resolve the configured name independently through every gateway."""
    client = fetcher or Fetcher(config)
    resolved: list[str] = []
    for gateway in config.gateways:
        resolution = client.get(
            _format_url(gateway.resolve_url, name=config.arns_name), json_value=True
        )
        txid = resolution.get("txId") if isinstance(resolution, dict) else None
        if not isinstance(txid, str) or TXID.fullmatch(txid) is None:
            raise MonitoringError(f"gateway {gateway.name} returned no valid resolver txId")
        resolved.append(txid)
    return resolved


def resolver_consensus(resolved: Sequence[str]) -> str | None:
    """Return a strict-majority TXID, or None when gateways have no consensus."""
    if not resolved:
        return None
    txid, count = collections.Counter(resolved).most_common(1)[0]
    return txid if count * 2 > len(resolved) else None


def fetch_credential_index(
    config: Config,
    fetcher: Fetcher,
    release_json_bytes: bytes,
    channel: ReleaseChannel,
) -> CredentialIndex:
    copies = [
        fetcher.get(
            _format_url(gateway.raw_url, txid=config.credential_index_txid)
        )
        for gateway in config.gateways
    ]
    if any(copy != copies[0] for copy in copies):
        raise MonitoringError("gateway bytes diverge for the credential index")
    actual_digest = hashlib.sha256(copies[0]).hexdigest()
    if actual_digest != config.credential_index_sha256:
        raise MonitoringError("credential index SHA-256 differs from operator pin")
    try:
        index = parse_credential_index(copies[0])
    except CredentialIndexError as error:
        raise MonitoringError(str(error)) from error
    if index.release_json_sha256 != hashlib.sha256(release_json_bytes).hexdigest():
        raise MonitoringError("credential index binds a different release.json")
    if index.manifest_txid != channel.manifest_txid:
        raise MonitoringError("credential index manifest_txid differs from ReleaseChannel")
    return index


@dataclass(frozen=True)
class PathManifest:
    paths: tuple[str, ...]
    index_path: str


def _parse_path_manifest(raw: bytes, label: str) -> PathManifest:
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MonitoringError(f"{label} is not valid JSON") from error
    if not isinstance(document, dict):
        raise MonitoringError(f"{label} is not an object")
    paths = document.get("paths")
    if not isinstance(paths, dict) or not paths:
        raise MonitoringError(f"{label} has no paths object")
    names: list[str] = []
    for raw_path, row in paths.items():
        try:
            path = _release_path(raw_path)
        except MonitoringError as error:
            raise MonitoringError(f"{label} contains an unsafe/non-string path") from error
        txid = row.get("id") if isinstance(row, dict) else None
        if not isinstance(txid, str) or TXID.fullmatch(txid) is None:
            raise MonitoringError(f"{label} path {path!r} has no valid transaction id")
        names.append(path)
    index = document.get("index")
    index_path = index.get("path") if isinstance(index, dict) else None
    if not isinstance(index_path, str) or index_path not in paths:
        raise MonitoringError(
            f"{label} index.path must name one listed bundle path"
        )
    return PathManifest(tuple(sorted(names)), index_path)


def fetch_release(
    config: Config, channel: ReleaseChannel, fetcher: Fetcher | None = None
) -> tuple[
    dict[str, bytes], dict[str, Any], bytes, list[str], list[str], list[str]
]:
    client = fetcher or Fetcher(config)
    resolved = resolve_arns(config, client)
    raw_final_manifests: list[bytes] = []
    for gateway, txid in zip(config.gateways, resolved):
        raw_final_manifests.append(
            client.get(_format_url(gateway.raw_url, txid=txid))
        )
    if any(raw != raw_final_manifests[0] for raw in raw_final_manifests):
        raise MonitoringError("gateway bytes diverge for the final path manifest")
    final_manifest = _parse_path_manifest(
        raw_final_manifests[0], "final Arweave path manifest"
    )

    route_values: dict[str, list[bytes]] = {
        path: [] for path in final_manifest.paths
    }
    for gateway, resolved_txid in zip(config.gateways, resolved):
        for path in final_manifest.paths:
            route_values[path].append(
                client.get(_format_url(gateway.tx_url, txid=resolved_txid, path=path))
            )
            route_values[path].append(
                client.get(_format_url(gateway.name_url, name=config.arns_name, path=path))
            )
    representative = {path: values[0] for path, values in route_values.items()}
    release_raw = representative.get("release.json")
    if release_raw is None:
        raise MonitoringError("served bundle has no release.json")
    try:
        release_document = json.loads(release_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MonitoringError("served release.json is invalid JSON") from error
    release = parse_app_release(release_document)
    expected_paths = set(release.per_file_hashes)
    if release.asset_manifest_txid in resolved:
        raise MonitoringError(
            "release.json asset manifest must differ from the final resolved manifest"
        )
    raw_asset_manifests = [
        client.get(
            _format_url(gateway.raw_url, txid=release.asset_manifest_txid)
        )
        for gateway in config.gateways
    ]
    if any(raw != raw_asset_manifests[0] for raw in raw_asset_manifests):
        raise MonitoringError("gateway bytes diverge for the asset path manifest")
    asset_manifest = _parse_path_manifest(
        raw_asset_manifests[0], "asset Arweave path manifest"
    )
    if set(asset_manifest.paths) != expected_paths:
        raise MonitoringError(
            "asset manifest paths must equal release.json perFileHashes"
        )
    if set(final_manifest.paths) != expected_paths | {"release.json"}:
        raise MonitoringError(
            "final manifest paths must equal asset manifest paths plus release.json"
        )
    if asset_manifest.index_path != final_manifest.index_path:
        raise MonitoringError(
            "asset and final path manifests select different index.path values"
        )

    # M is what the signed document authorizes. Fetch it as well as M-prime (the
    # browser-visible final/name routes) so the two-pass binding is checked in
    # bytes rather than inferred from matching path names.
    for gateway in config.gateways:
        for path in asset_manifest.paths:
            route_values[path].append(
                client.get(
                    _format_url(
                        gateway.tx_url,
                        txid=release.asset_manifest_txid,
                        path=path,
                    )
                )
            )

    # Route disagreement is represented as extra mismatch pseudo-paths, keeping
    # the pure comparison core unaware of gateway/network shape.
    compared_files = {path: representative[path] for path in expected_paths}
    for path, values in route_values.items():
        if path == "release.json":
            if any(value != release_raw for value in values):
                compared_files[f"__route_mismatch__/{path}"] = b"mismatch"
        elif any(value != representative[path] for value in values):
            compared_files[f"__route_mismatch__/{path}"] = b"mismatch"

    # A browser opens the manifest-selected root route, not `/index.html` by
    # convention. Probe the actual immutable and named roots independently and
    # bind both to the already hash-checked index path. Explicit root templates
    # keep an operator's path API from being mistaken for the browser route.
    expected_root = representative[final_manifest.index_path]
    for gateway, resolved_txid in zip(config.gateways, resolved):
        immutable_root = client.get(
            _format_url(gateway.tx_root_url, txid=resolved_txid)
        )
        named_root = client.get(
            _format_url(gateway.name_root_url, name=config.arns_name)
        )
        if immutable_root != expected_root:
            compared_files[
                f"__route_mismatch__/{gateway.name}/immutable-root"
            ] = b"mismatch"
        if named_root != expected_root:
            compared_files[f"__route_mismatch__/{gateway.name}/name-root"] = b"mismatch"

    credential_index = fetch_credential_index(config, client, release_raw, channel)

    def signature_transactions(field: str, txids: Sequence[str]) -> list[str]:
        blobs: list[str] = []
        for txid in txids:
            copies = [
                client.get(_format_url(gateway.raw_url, txid=txid))
                for gateway in config.gateways
            ]
            if any(copy != copies[0] for copy in copies):
                raise MonitoringError(f"gateway bytes diverge for {field} transaction {txid}")
            try:
                blobs.append(copies[0].decode("utf-8"))
            except UnicodeDecodeError as error:
                raise MonitoringError(f"{field} transaction {txid} is not UTF-8 minisign") from error
        return blobs

    return (
        compared_files,
        release_document,
        release_raw,
        signature_transactions(
            "release_signatures", credential_index.release_signature_txids
        ),
        signature_transactions("attestations", credential_index.attestation_txids),
        resolved,
    )


def _webhook_error_summary(error: Exception) -> str:
    if isinstance(error, urllib.error.HTTPError):
        return f"HTTP {error.code}"
    if isinstance(error, urllib.error.URLError):
        return f"transport {type(error.reason).__name__}"
    if isinstance(error, MonitoringError):
        status = re.fullmatch(r"HTTP ([0-9]{3})", str(error))
        return status.group(0) if status is not None else "MonitoringError"
    return type(error).__name__


def post_webhooks(config: Config, payload: Mapping[str, Any], store: MetricStore) -> None:
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    for channel, urls in config.webhooks.items():
        for url in urls:
            try:
                request = urllib.request.Request(
                    url,
                    data=body,
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "bleavit-attestation-monitor/1",
                    },
                )
                with urllib.request.urlopen(request, timeout=10) as response:
                    if not 200 <= response.status < 300:
                        raise MonitoringError(f"HTTP {response.status}")
            except Exception as error:
                store.inc("bleavit_release_monitor_webhook_failures_total")
                LOG.error(
                    "%s webhook delivery failed: %s",
                    channel,
                    _webhook_error_summary(error),
                )


class AttestationMonitor:
    def __init__(self, config: Config, store: MetricStore | None = None):
        self.config = config
        self.store = store or MetricStore(SERIES)
        self.last_majority_txid: str | None = None
        self.last_resolved_txids: tuple[str, ...] | None = None
        self.repoint_mismatch_since: int | None = None
        for counter in (
            "bleavit_release_monitor_checks_total",
            "bleavit_release_monitor_errors_total",
            "bleavit_release_monitor_ant_record_changes_total",
            "bleavit_release_monitor_webhook_failures_total",
        ):
            self.store.set(counter, 0)

    def check(self, release_channel_bytes: bytes, block: int) -> IntegrityVerdict:
        channel = decode_release_channel(release_channel_bytes)
        files, document, release_raw, signatures, attestations, resolved = fetch_release(
            self.config, channel
        )
        release = parse_app_release(document)
        verdict = evaluate_integrity(
            files=files,
            expected_hashes=release.per_file_hashes,
            release_json_bytes=release_raw,
            release_document=document,
            release_signatures=signatures,
            attestations=attestations,
            keyring=load_keyring(self.config.keyring_file),
            release_channel_bytes=release_channel_bytes,
            resolved_txids=resolved,
            minimum_release_signatures=self.config.minimum_release_signatures,
        )
        majority = resolver_consensus(resolved)
        if self.last_majority_txid is not None and majority != self.last_majority_txid:
            self.store.inc("bleavit_release_monitor_ant_record_changes_total")
        self.last_majority_txid = majority
        self.last_resolved_txids = tuple(resolved)
        if majority != channel.manifest_txid:
            if self.repoint_mismatch_since is None:
                self.repoint_mismatch_since = block
            lag = max(0, block - self.repoint_mismatch_since)
        else:
            self.repoint_mismatch_since = None
            lag = 0
        values = {
            "bleavit_release_monitor_up": 1,
            "bleavit_release_monitor_integrity_ok": int(verdict.ok),
            "bleavit_release_monitor_bundle_byte_mismatches": verdict.byte_mismatches,
            "bleavit_release_monitor_resolver_divergent_gateways": verdict.resolver_divergent_gateways,
            "bleavit_release_monitor_valid_release_signatures": verdict.valid_release_signatures,
            "bleavit_release_monitor_valid_attestations": verdict.valid_attestations,
            "bleavit_release_monitor_keyring_generation": channel.keyring_generation,
            "bleavit_release_monitor_manifest_matches_channel": int(verdict.manifest_matches_channel),
            "bleavit_release_monitor_covering_release": int(verdict.covering_release),
            "bleavit_release_monitor_repoint_channel_lag_blocks": lag,
            "bleavit_release_monitor_last_check_timestamp_seconds": time.time(),
        }
        for name, value in values.items():
            self.store.set(name, value)
        self.store.inc("bleavit_release_monitor_checks_total")
        if not verdict.ok:
            post_webhooks(
                self.config,
                {
                    "alert": "BleavitReleaseIntegrity",
                    "runbook": "RB-RELEASE",
                    "block": block,
                    "manifest_txid": channel.manifest_txid,
                    "errors": list(verdict.errors),
                },
                self.store,
            )
        return verdict

    def resolver_state_changed(self) -> bool:
        """Poll resolver records between full, hourly bundle checks."""
        resolved = tuple(resolve_arns(self.config))
        return self.last_resolved_txids is None or resolved != self.last_resolved_txids

    def note_finalized_head(self, block: int) -> None:
        """Advance the repoint lag gauge without refetching an unchanged bundle."""
        lag = 0
        if self.repoint_mismatch_since is not None:
            lag = max(0, block - self.repoint_mismatch_since)
        self.store.set("bleavit_release_monitor_repoint_channel_lag_blocks", lag)


def read_channel(rpc: WsRpc, block_hash: str) -> bytes:
    raw = hex_bytes(
        rpc.call("state_getStorage", [RELEASE_CHANNEL_KEY, block_hash]),
        "ReleaseChannel storage",
    )
    assert raw is not None
    return raw


@dataclass(frozen=True)
class RpcQuorumObservation:
    block_hash: str
    block_number: int
    release_channel_bytes: bytes


def _hash32(value: Any, label: str) -> str:
    decoded = hex_bytes(value, label)
    if decoded is None or len(decoded) != 32:
        raise MonitoringError(f"{label} must contain exactly 32 bytes")
    return "0x" + decoded.hex()


def read_rpc_quorum(
    connections: Sequence[tuple[RpcEndpoint, WsRpc]],
    expected_genesis_hash: str,
) -> RpcQuorumObservation:
    """Require exact m-of-m RPC agreement; this is not storage-proof verification."""
    if len(connections) < 3:
        raise MonitoringError("RPC quorum requires at least three independent endpoints")
    observations: list[tuple[str, RpcQuorumObservation]] = []
    for endpoint, rpc in connections:
        genesis = _hash32(
            rpc.call("chain_getBlockHash", [0]),
            f"rpc {endpoint.operator} genesis hash",
        )
        if genesis != expected_genesis_hash:
            raise MonitoringError(
                f"rpc {endpoint.operator} genesis hash differs from the configured Bleavit chain"
            )
        block_hash = _hash32(
            rpc.call("chain_getFinalizedHead"),
            f"rpc {endpoint.operator} finalized hash",
        )
        block = header_number(rpc.call("chain_getHeader", [block_hash]))
        channel_bytes = read_channel(rpc, block_hash)
        observations.append(
            (
                endpoint.operator,
                RpcQuorumObservation(block_hash, block, channel_bytes),
            )
        )
    first_operator, first = observations[0]
    for operator, observation in observations[1:]:
        if observation != first:
            raise MonitoringError(
                "RPC quorum disagreement between operators "
                f"{first_operator} and {operator}"
            )
    return first


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify canonical Bleavit releases out of band.")
    parser.add_argument("--config", type=Path, required=True, help="operator TOML configuration")
    parser.add_argument("--bind", help="override monitor.bind for the Prometheus endpoint")
    parser.add_argument("--once", action="store_true", help="check once; exit 0 healthy, 1 mismatch, 2 operational error")
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    try:
        config = load_config(args.config)
        if args.bind:
            config = Config(**{**config.__dict__, "bind": args.bind})
    except MonitoringError as error:
        LOG.error("configuration error: %s", error)
        return 2
    store = MetricStore(SERIES)
    monitor = AttestationMonitor(config, store)
    if not args.once:
        try:
            serve_metrics(store, config.bind)
        except (OSError, MonitoringError) as error:
            LOG.error("metrics bind failed: %s", error)
            return 2
    backoff = 1.0
    last_channel: bytes | None = None
    last_check = 0.0
    while True:
        connections: list[tuple[RpcEndpoint, WsRpc]] = []
        try:
            for endpoint in config.rpc_endpoints:
                connections.append((endpoint, WsRpc(endpoint.url)))
            observation = read_rpc_quorum(connections, config.expected_genesis_hash)
            verdict = monitor.check(
                observation.release_channel_bytes, observation.block_number
            )
            last_check = time.monotonic()
            last_channel = observation.release_channel_bytes
            if args.once:
                sys.stdout.write(store.render())
                return 0 if verdict.ok else 1
            trigger_rpc = connections[0][1]
            subscription = trigger_rpc.subscribe_finalized()
            backoff = 1.0
            while True:
                remaining = max(
                    0.1,
                    config.check_interval_seconds - (time.monotonic() - last_check),
                )
                trigger_rpc.next_finalized(
                    subscription,
                    timeout=min(remaining, config.rpc_poll_interval_seconds),
                )
                observation = read_rpc_quorum(
                    connections, config.expected_genesis_hash
                )
                channel_bytes = observation.release_channel_bytes
                block = observation.block_number
                monitor.note_finalized_head(block)
                channel_changed = channel_bytes != last_channel
                hourly_due = time.monotonic() - last_check >= config.check_interval_seconds
                resolver_changed = False
                if not channel_changed and not hourly_due:
                    resolver_changed = monitor.resolver_state_changed()
                if channel_changed or resolver_changed or hourly_due:
                    monitor.check(channel_bytes, block)
                    last_channel = channel_bytes
                    last_check = time.monotonic()
        except KeyboardInterrupt:
            return 0
        except Exception as error:  # urllib/websocket transports expose varied subclasses.
            store.set("bleavit_release_monitor_up", 0)
            store.set("bleavit_release_monitor_integrity_ok", 0)
            store.set("bleavit_release_monitor_last_check_timestamp_seconds", time.time())
            store.inc("bleavit_release_monitor_errors_total")
            LOG.error("monitor check failed: %s", error)
            post_webhooks(
                config,
                {"alert": "BleavitReleaseIntegrity", "runbook": "RB-RELEASE", "errors": [str(error)]},
                store,
            )
            if args.once:
                sys.stdout.write(store.render())
                return 2
            time.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
        finally:
            for _, rpc in connections:
                try:
                    rpc.close()
                except Exception:
                    pass


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
