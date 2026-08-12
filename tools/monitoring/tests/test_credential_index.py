from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

from support import FINAL_MANIFEST_TXID, integrity_fixture, release_channel_bytes

import attestation_monitor as am
import credential_index as ci
from common import MonitoringError, decode_release_channel


RELEASE_TXIDS = ("R" * 43, "S" * 43)
ATTESTATION_TXIDS = ("A" * 43, "B" * 43)
INDEX_TXID = "I" * 43
APP_RELEASE_FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "app"
    / "fixtures"
    / "gateway-transcript"
    / "cli-release.json"
)


class FakeFetcher:
    def __init__(self, responses: dict[str, bytes]):
        self.responses = responses

    def get(self, url: str, *, json_value: bool = False):
        value = self.responses[url]
        return json.loads(value) if json_value else value


class CredentialIndexTests(unittest.TestCase):
    def test_real_app_producer_bytes_feed_index_and_unattended_consumer(self) -> None:
        release_raw = APP_RELEASE_FIXTURE.read_bytes()
        release_document = json.loads(release_raw)
        app_release = am.parse_app_release(release_document)
        self.assertEqual(
            app_release.asset_manifest_txid,
            release_document["arweaveManifestTxId"],
        )
        self.assertEqual(app_release.per_file_hashes, release_document["perFileHashes"])
        self.assertEqual(
            (app_release.primary_spec_version, app_release.recovery_spec_version),
            (2, 3),
        )
        self.assertEqual(app_release.keyring_generation, 4)
        first = ci.build_credential_index(
            release_raw,
            FINAL_MANIFEST_TXID,
            RELEASE_TXIDS,
            ATTESTATION_TXIDS,
        )
        second = ci.build_credential_index(
            release_raw,
            FINAL_MANIFEST_TXID,
            RELEASE_TXIDS,
            ATTESTATION_TXIDS,
        )
        self.assertEqual(first, second)
        self.assertNotIn(b"release_signatures", release_raw)
        index = ci.parse_credential_index(first)
        self.assertEqual(
            index.release_json_sha256,
            hashlib.sha256(release_raw).hexdigest(),
        )
        self.assertEqual(index.manifest_txid, FINAL_MANIFEST_TXID)
        self.assertEqual(index.release_signature_txids, RELEASE_TXIDS)
        self.assertEqual(index.attestation_txids, ATTESTATION_TXIDS)

        gateways = tuple(
            am.Gateway(
                f"g{number}",
                f"gateway-operator-{number}",
                f"https://g{number}.invalid/resolve/{{name}}",
                f"https://g{number}.invalid/raw/{{txid}}",
                f"https://g{number}.invalid/{{txid}}/{{path}}",
                f"https://{{name}}.g{number}.invalid/{{path}}",
                f"https://g{number}.invalid/{{txid}}/",
                f"https://{{name}}.g{number}.invalid/",
            )
            for number in range(3)
        )
        responses = {
            am._format_url(gateway.raw_url, txid=INDEX_TXID): first
            for gateway in gateways
        }
        config = SimpleNamespace(
            gateways=gateways,
            credential_index_txid=INDEX_TXID,
            credential_index_sha256=hashlib.sha256(first).hexdigest(),
        )
        consumed = am.fetch_credential_index(
            config,
            FakeFetcher(responses),
            release_raw,
            decode_release_channel(
                release_channel_bytes(
                    release_json_hash=hashlib.sha256(release_raw).digest(),
                    spec_version=2,
                    generation=4,
                )
            ),
        )
        self.assertEqual(consumed, index)

    def test_consumer_rejects_wrong_out_of_band_digest_and_release_binding(self) -> None:
        fixture = integrity_fixture()
        raw = ci.build_credential_index(
            fixture["release_raw"],
            FINAL_MANIFEST_TXID,
            RELEASE_TXIDS,
            ATTESTATION_TXIDS,
        )
        gateways = tuple(
            am.Gateway(
                f"g{number}",
                f"gateway-operator-{number}",
                f"https://g{number}.invalid/resolve/{{name}}",
                f"https://g{number}.invalid/raw/{{txid}}",
                f"https://g{number}.invalid/{{txid}}/{{path}}",
                f"https://{{name}}.g{number}.invalid/{{path}}",
                f"https://g{number}.invalid/{{txid}}/",
                f"https://{{name}}.g{number}.invalid/",
            )
            for number in range(3)
        )
        responses = {
            am._format_url(gateway.raw_url, txid=INDEX_TXID): raw
            for gateway in gateways
        }
        config = SimpleNamespace(
            gateways=gateways,
            credential_index_txid=INDEX_TXID,
            credential_index_sha256="0" * 64,
        )
        channel = decode_release_channel(fixture["channel"])
        with self.assertRaisesRegex(MonitoringError, "operator pin"):
            am.fetch_credential_index(
                config, FakeFetcher(responses), fixture["release_raw"], channel
            )

        config.credential_index_sha256 = hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(MonitoringError, "different release.json"):
            am.fetch_credential_index(
                config, FakeFetcher(responses), fixture["release_raw"] + b" ", channel
            )

    def test_schema_rejects_unknown_fields_and_duplicate_transactions(self) -> None:
        fixture = integrity_fixture()
        raw = ci.build_credential_index(
            fixture["release_raw"],
            FINAL_MANIFEST_TXID,
            RELEASE_TXIDS,
            ATTESTATION_TXIDS,
        )
        document = json.loads(raw)
        document["unexpected"] = True
        with self.assertRaisesRegex(ci.CredentialIndexError, "unexpected"):
            ci.parse_credential_index(json.dumps(document).encode())
        document.pop("unexpected")
        document["attestations"][1] = document["attestations"][0]
        with self.assertRaisesRegex(ci.CredentialIndexError, "duplicate txid"):
            ci.parse_credential_index(json.dumps(document).encode())
        document["attestations"] = [{"txid": RELEASE_TXIDS[0]}, {"txid": "Z" * 43}]
        with self.assertRaisesRegex(ci.CredentialIndexError, "across credential roles"):
            ci.parse_credential_index(json.dumps(document).encode())

    def test_producer_requires_explicit_distinct_final_manifest(self) -> None:
        fixture = integrity_fixture()
        with self.assertRaisesRegex(ci.CredentialIndexError, "must differ"):
            ci.build_credential_index(
                fixture["release_raw"],
                fixture["document"]["arweaveManifestTxId"],
                RELEASE_TXIDS,
                ATTESTATION_TXIDS,
            )
        provisional = json.dumps(
            {
                "schema": "bleavit.release.provisional.v1",
                "manifest_txid": FINAL_MANIFEST_TXID,
            }
        ).encode()
        with self.assertRaisesRegex(ci.CredentialIndexError, "app-release.v1"):
            ci.build_credential_index(
                provisional,
                FINAL_MANIFEST_TXID,
                RELEASE_TXIDS,
                ATTESTATION_TXIDS,
            )

    def test_cli_producer_writes_parseable_bytes_and_reports_the_pin(self) -> None:
        fixture = integrity_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "release.json"
            output = root / "credentials.json"
            release.write_bytes(fixture["release_raw"])
            arguments = [
                "--release-json",
                str(release),
                "--final-manifest",
                FINAL_MANIFEST_TXID,
                "--output",
                str(output),
            ]
            for txid in RELEASE_TXIDS:
                arguments.extend(("--release-signature", txid))
            for txid in ATTESTATION_TXIDS:
                arguments.extend(("--attestation", txid))
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(ci.main(arguments), 0)
            raw = output.read_bytes()
            ci.parse_credential_index(raw)
            self.assertEqual(
                stdout.getvalue().splitlines(),
                [f"credential_index_sha256={hashlib.sha256(raw).hexdigest()}"],
            )


if __name__ == "__main__":
    unittest.main()
