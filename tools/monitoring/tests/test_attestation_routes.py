from __future__ import annotations

import hashlib
import json
import unittest
from types import SimpleNamespace

from support import ASSET_MANIFEST_TXID, FINAL_MANIFEST_TXID, integrity_fixture

import attestation_monitor as am
import credential_index as ci
from common import MonitoringError, decode_release_channel


RELEASE_SIGNATURE_TXIDS = ("R" * 43, "S" * 43)
ATTESTATION_TXIDS = ("T" * 43, "U" * 43)
INDEX_TXID = "I" * 43


class FakeFetcher:
    def __init__(self, responses: dict[str, bytes]):
        self.responses = responses

    def get(self, url: str, *, json_value: bool = False):
        value = self.responses[url]
        return json.loads(value) if json_value else value


def route_fixture():
    fixture = integrity_fixture()
    gateways = tuple(
        am.Gateway(
            f"g{number}",
            f"gateway-operator-{number}",
            f"https://g{number}.invalid/resolve/{{name}}",
            f"https://g{number}.invalid/raw/{{txid}}",
            f"https://g{number}.invalid/tx/{{txid}}/{{path}}",
            f"https://g{number}.invalid/name/{{name}}/{{path}}",
            f"https://g{number}.invalid/tx-root/{{txid}}",
            f"https://g{number}.invalid/name-root/{{name}}",
        )
        for number in range(3)
    )
    asset_manifest = {
        "manifest": "arweave/paths",
        "version": "0.2.0",
        "index": {"path": "index.html"},
        "paths": {
            path: {"id": chr(ord("A") + index) * 43}
            for index, path in enumerate(fixture["files"])
        },
    }
    final_manifest = {
        **asset_manifest,
        "paths": {
            **asset_manifest["paths"],
            "release.json": {"id": "R" * 43},
        },
    }
    asset_manifest_raw = json.dumps(
        asset_manifest, sort_keys=True, separators=(",", ":")
    ).encode()
    final_manifest_raw = json.dumps(
        final_manifest, sort_keys=True, separators=(",", ":")
    ).encode()
    credential_raw = ci.build_credential_index(
        fixture["release_raw"],
        FINAL_MANIFEST_TXID,
        RELEASE_SIGNATURE_TXIDS,
        ATTESTATION_TXIDS,
    )
    config = SimpleNamespace(
        gateways=gateways,
        arns_name="futarchy",
        credential_index_txid=INDEX_TXID,
        credential_index_sha256=hashlib.sha256(credential_raw).hexdigest(),
    )
    responses: dict[str, bytes] = {}
    for gateway in gateways:
        responses[am._format_url(gateway.resolve_url, name=config.arns_name)] = (
            json.dumps({"txId": FINAL_MANIFEST_TXID}).encode()
        )
        responses[
            am._format_url(gateway.raw_url, txid=FINAL_MANIFEST_TXID)
        ] = final_manifest_raw
        responses[
            am._format_url(gateway.raw_url, txid=ASSET_MANIFEST_TXID)
        ] = asset_manifest_raw
        for path, value in {**fixture["files"], "release.json": fixture["release_raw"]}.items():
            responses[
                am._format_url(
                    gateway.tx_url, txid=FINAL_MANIFEST_TXID, path=path
                )
            ] = value
            responses[
                am._format_url(gateway.name_url, name=config.arns_name, path=path)
            ] = value
        for path, value in fixture["files"].items():
            responses[
                am._format_url(
                    gateway.tx_url, txid=ASSET_MANIFEST_TXID, path=path
                )
            ] = value
        responses[
            am._format_url(gateway.tx_root_url, txid=FINAL_MANIFEST_TXID)
        ] = fixture["files"]["index.html"]
        responses[
            am._format_url(gateway.name_root_url, name=config.arns_name)
        ] = fixture["files"]["index.html"]
        responses[am._format_url(gateway.raw_url, txid=INDEX_TXID)] = credential_raw
        for txid in RELEASE_SIGNATURE_TXIDS:
            responses[am._format_url(gateway.raw_url, txid=txid)] = fixture[
                "signatures"
            ][0].encode()
        for txid, signature in zip(ATTESTATION_TXIDS, fixture["attestations"]):
            responses[am._format_url(gateway.raw_url, txid=txid)] = signature.encode()
    return (
        fixture,
        gateways,
        config,
        responses,
        asset_manifest_raw,
        final_manifest_raw,
    )


class AttestationRouteTests(unittest.TestCase):
    def test_honest_root_and_all_raw_manifest_copies_are_accepted(self) -> None:
        fixture, _, config, responses, _, _ = route_fixture()
        files, document, release_raw, _, _, resolved = am.fetch_release(
            config,
            decode_release_channel(fixture["channel"]),
            FakeFetcher(responses),
        )
        self.assertEqual(files, fixture["files"])
        self.assertEqual(document, fixture["document"])
        self.assertEqual(release_raw, fixture["release_raw"])
        self.assertEqual(resolved, fixture["resolved"])

    def test_hostile_browser_root_is_an_integrity_mismatch(self) -> None:
        for root_field, suffix in (
            ("tx_root_url", "immutable-root"),
            ("name_root_url", "name-root"),
        ):
            with self.subTest(root_field=root_field):
                fixture, gateways, config, responses, _, _ = route_fixture()
                gateway = gateways[1]
                template = getattr(gateway, root_field)
                values = (
                    {"txid": FINAL_MANIFEST_TXID}
                    if root_field == "tx_root_url"
                    else {"name": config.arns_name}
                )
                responses[am._format_url(template, **values)] = b"hostile root"

                files, document, release_raw, signatures, attestations, resolved = (
                    am.fetch_release(
                        config,
                        decode_release_channel(fixture["channel"]),
                        FakeFetcher(responses),
                    )
                )
                mismatch = f"__route_mismatch__/{gateway.name}/{suffix}"
                self.assertIn(mismatch, files)
                verdict = am.evaluate_integrity(
                    files=files,
                    expected_hashes=document["perFileHashes"],
                    release_json_bytes=release_raw,
                    release_document=document,
                    release_signatures=signatures,
                    attestations=attestations,
                    keyring=fixture["keyring"],
                    release_channel_bytes=fixture["channel"],
                    resolved_txids=resolved,
                    minimum_release_signatures=1,
                )
                self.assertFalse(verdict.ok)
                self.assertTrue(any(mismatch in error for error in verdict.errors))

    def test_one_gateway_cannot_substitute_path_manifest_bytes(self) -> None:
        fixture, gateways, config, responses, _, final_manifest_raw = route_fixture()
        responses[
            am._format_url(
                gateways[1].raw_url, txid=FINAL_MANIFEST_TXID
            )
        ] = final_manifest_raw + b" "
        with self.assertRaisesRegex(MonitoringError, "final path manifest"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_manifest_index_must_name_a_listed_path(self) -> None:
        fixture, gateways, config, responses, _, final_manifest_raw = route_fixture()
        manifest = json.loads(final_manifest_raw)
        manifest["index"]["path"] = "missing.html"
        replacement = json.dumps(
            manifest, sort_keys=True, separators=(",", ":")
        ).encode()
        for gateway in gateways:
            responses[
                am._format_url(gateway.raw_url, txid=FINAL_MANIFEST_TXID)
            ] = replacement
        with self.assertRaisesRegex(MonitoringError, "index.path"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_asset_manifest_paths_must_equal_the_signed_file_map(self) -> None:
        fixture, gateways, config, responses, asset_manifest_raw, _ = route_fixture()
        manifest = json.loads(asset_manifest_raw)
        manifest["paths"]["extra.js"] = {"id": "X" * 43}
        replacement = json.dumps(
            manifest, sort_keys=True, separators=(",", ":")
        ).encode()
        for gateway in gateways:
            responses[
                am._format_url(gateway.raw_url, txid=ASSET_MANIFEST_TXID)
            ] = replacement
        with self.assertRaisesRegex(MonitoringError, "asset manifest paths"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_provisional_release_schema_has_no_compatibility_alias(self) -> None:
        fixture, gateways, config, responses, _, _ = route_fixture()
        provisional = json.dumps(
            {
                "schema": "bleavit.release.provisional.v1",
                "manifest_txid": FINAL_MANIFEST_TXID,
                "files": fixture["hashes"],
            }
        ).encode()
        for gateway in gateways:
            responses[
                am._format_url(
                    gateway.tx_url,
                    txid=FINAL_MANIFEST_TXID,
                    path="release.json",
                )
            ] = provisional
            responses[
                am._format_url(
                    gateway.name_url,
                    name=config.arns_name,
                    path="release.json",
                )
            ] = provisional
        with self.assertRaisesRegex(MonitoringError, "bleavit.app-release.v1"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_asset_and_final_manifest_addresses_must_be_distinct(self) -> None:
        fixture, gateways, config, responses, _, _ = route_fixture()
        document = {**fixture["document"], "arweaveManifestTxId": FINAL_MANIFEST_TXID}
        collapsed = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
        for gateway in gateways:
            responses[
                am._format_url(
                    gateway.tx_url,
                    txid=FINAL_MANIFEST_TXID,
                    path="release.json",
                )
            ] = collapsed
            responses[
                am._format_url(
                    gateway.name_url,
                    name=config.arns_name,
                    path="release.json",
                )
            ] = collapsed
        with self.assertRaisesRegex(MonitoringError, "must differ"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_credential_index_final_manifest_must_match_channel(self) -> None:
        fixture, gateways, config, responses, _, _ = route_fixture()
        other_final = "Z" * 43
        credential_raw = ci.build_credential_index(
            fixture["release_raw"],
            other_final,
            RELEASE_SIGNATURE_TXIDS,
            ATTESTATION_TXIDS,
        )
        config.credential_index_sha256 = hashlib.sha256(credential_raw).hexdigest()
        for gateway in gateways:
            responses[
                am._format_url(gateway.raw_url, txid=INDEX_TXID)
            ] = credential_raw
        with self.assertRaisesRegex(MonitoringError, "differs from ReleaseChannel"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )


if __name__ == "__main__":
    unittest.main()
