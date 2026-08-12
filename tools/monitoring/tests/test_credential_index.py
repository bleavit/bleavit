from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

from support import integrity_fixture

import attestation_monitor as am
import credential_index as ci
from common import MonitoringError, decode_release_channel


RELEASE_TXIDS = ("R" * 43, "S" * 43)
ATTESTATION_TXIDS = ("A" * 43, "B" * 43)
INDEX_TXID = "I" * 43


class FakeFetcher:
    def __init__(self, responses: dict[str, bytes]):
        self.responses = responses

    def get(self, url: str, *, json_value: bool = False):
        value = self.responses[url]
        return json.loads(value) if json_value else value


class CredentialIndexTests(unittest.TestCase):
    def test_producer_is_deterministic_and_consumer_binds_final_release(self) -> None:
        fixture = integrity_fixture()
        first = ci.build_credential_index(
            fixture["release_raw"], RELEASE_TXIDS, ATTESTATION_TXIDS
        )
        second = ci.build_credential_index(
            fixture["release_raw"], RELEASE_TXIDS, ATTESTATION_TXIDS
        )
        self.assertEqual(first, second)
        self.assertNotIn(b"release_signatures", fixture["release_raw"])
        index = ci.parse_credential_index(first)
        self.assertEqual(
            index.release_json_sha256,
            hashlib.sha256(fixture["release_raw"]).hexdigest(),
        )
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
            fixture["release_raw"],
            decode_release_channel(fixture["channel"]),
        )
        self.assertEqual(consumed, index)

    def test_consumer_rejects_wrong_out_of_band_digest_and_release_binding(self) -> None:
        fixture = integrity_fixture()
        raw = ci.build_credential_index(
            fixture["release_raw"], RELEASE_TXIDS, ATTESTATION_TXIDS
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
            fixture["release_raw"], RELEASE_TXIDS, ATTESTATION_TXIDS
        )
        document = json.loads(raw)
        document["unexpected"] = True
        with self.assertRaisesRegex(ci.CredentialIndexError, "unexpected"):
            ci.parse_credential_index(json.dumps(document).encode())
        document.pop("unexpected")
        document["attestations"][1] = document["attestations"][0]
        with self.assertRaisesRegex(ci.CredentialIndexError, "duplicate txid"):
            ci.parse_credential_index(json.dumps(document).encode())

    def test_cli_producer_writes_parseable_bytes_and_reports_the_pin(self) -> None:
        fixture = integrity_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "release.json"
            output = root / "credentials.json"
            release.write_bytes(fixture["release_raw"])
            arguments = ["--release-json", str(release), "--output", str(output)]
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
