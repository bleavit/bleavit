from __future__ import annotations

import hashlib
import json
import unittest
from types import SimpleNamespace

from support import integrity_fixture

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
    manifest = {
        "manifest": "arweave/paths",
        "version": "0.2.0",
        "index": {"path": "index.html"},
        "paths": {
            path: {"id": chr(ord("A") + index) * 43}
            for index, path in enumerate([*fixture["files"], "release.json"])
        },
    }
    manifest_raw = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    credential_raw = ci.build_credential_index(
        fixture["release_raw"], RELEASE_SIGNATURE_TXIDS, ATTESTATION_TXIDS
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
            json.dumps({"txId": "A" * 43}).encode()
        )
        responses[am._format_url(gateway.raw_url, txid="A" * 43)] = manifest_raw
        for path, value in {**fixture["files"], "release.json": fixture["release_raw"]}.items():
            responses[
                am._format_url(gateway.tx_url, txid="A" * 43, path=path)
            ] = value
            responses[
                am._format_url(gateway.name_url, name=config.arns_name, path=path)
            ] = value
        responses[am._format_url(gateway.tx_root_url, txid="A" * 43)] = fixture[
            "files"
        ]["index.html"]
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
    return fixture, gateways, config, responses, manifest_raw


class AttestationRouteTests(unittest.TestCase):
    def test_honest_root_and_all_raw_manifest_copies_are_accepted(self) -> None:
        fixture, _, config, responses, _ = route_fixture()
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
                fixture, gateways, config, responses, _ = route_fixture()
                gateway = gateways[1]
                template = getattr(gateway, root_field)
                values = (
                    {"txid": "A" * 43}
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
                    expected_hashes=document["files"],
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
        fixture, gateways, config, responses, manifest_raw = route_fixture()
        responses[
            am._format_url(gateways[1].raw_url, txid="A" * 43)
        ] = manifest_raw + b" "
        with self.assertRaisesRegex(MonitoringError, "path manifest"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )

    def test_manifest_index_must_name_a_listed_path(self) -> None:
        fixture, gateways, config, responses, manifest_raw = route_fixture()
        manifest = json.loads(manifest_raw)
        manifest["index"]["path"] = "missing.html"
        replacement = json.dumps(
            manifest, sort_keys=True, separators=(",", ":")
        ).encode()
        for gateway in gateways:
            responses[am._format_url(gateway.raw_url, txid="A" * 43)] = replacement
        with self.assertRaisesRegex(MonitoringError, "index.path"):
            am.fetch_release(
                config,
                decode_release_channel(fixture["channel"]),
                FakeFetcher(responses),
            )


if __name__ == "__main__":
    unittest.main()
