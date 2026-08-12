from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import attestation_monitor as am
from common import MonitoringError, parse_bind


def config_text(
    gateway_count: int = 3,
    rpc_count: int = 3,
    interval: int = 3600,
    minimum_signatures: int = 2,
) -> str:
    gateways = []
    for index in range(gateway_count):
        gateways.append(
            f'''\n[[gateway]]
name = "g{index}"
operator = "gateway-operator-{index}"
resolve_url = "https://g{index}.example.invalid/ar-io/resolver/{{name}}"
raw_url = "https://g{index}.example.invalid/raw/{{txid}}"
tx_url = "https://g{index}.example.invalid/{{txid}}/{{path}}"
name_url = "https://{{name}}.g{index}.example.invalid/{{path}}"
tx_root_url = "https://g{index}.example.invalid/{{txid}}/"
name_root_url = "https://{{name}}.g{index}.example.invalid/"
'''
        )
    rpcs = []
    for index in range(rpc_count):
        rpcs.append(
            f'''\n[[rpc]]
operator = "rpc-operator-{index}"
url = "wss://rpc{index}.example.invalid"
'''
        )
    return f'''[monitor]
expected_genesis_hash = "0x{'11' * 32}"
credential_index_txid = "{'C' * 43}"
credential_index_sha256 = "{'22' * 32}"
arns_name = "futarchy"
keyring_file = "keyring.toml"
bind = "127.0.0.1:9618"
check_interval_seconds = {interval}
rpc_poll_interval_seconds = 15
minimum_release_signatures = {minimum_signatures}
max_file_bytes = 1000
max_bundle_bytes = 10000
{''.join(gateways)}
{''.join(rpcs)}
[webhooks]
paging = ["https://paging.example.invalid"]
status_page = ["https://status.example.invalid"]
community = ["https://community.example.invalid"]
'''


class ConfigValidationTests(unittest.TestCase):
    def load(self, text: str) -> am.Config:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.toml"
            path.write_text(text, encoding="utf-8")
            return am.load_config(path)

    def test_three_independent_gateways_are_accepted(self) -> None:
        config = self.load(config_text())
        self.assertEqual(len(config.gateways), 3)
        self.assertEqual(config.check_interval_seconds, 3600)

    def test_fewer_than_three_gateways_fail(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "at least three"):
            self.load(config_text(2))

    def test_fewer_than_three_rpc_operators_fail(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "at least three"):
            self.load(config_text(rpc_count=2))

    def test_hourly_floor_is_enforced(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "hourly"):
            self.load(config_text(interval=3601))

    def test_missing_gateway_template_placeholder_fails(self) -> None:
        broken = config_text().replace("/raw/{txid}", "/raw/fixed", 1)
        with self.assertRaisesRegex(MonitoringError, "placeholders"):
            self.load(broken)

    def test_browser_root_templates_are_required(self) -> None:
        broken = config_text().replace(
            'tx_root_url = "https://g0.example.invalid/{txid}/"\n', "", 1
        )
        with self.assertRaisesRegex(MonitoringError, "documented fields"):
            self.load(broken)

    def test_gateway_operator_identity_must_be_distinct(self) -> None:
        broken = config_text().replace(
            'operator = "gateway-operator-1"',
            'operator = "gateway-operator-0"',
        )
        with self.assertRaisesRegex(MonitoringError, "gateway operator.*duplicated"):
            self.load(broken)

    def test_gateway_normalized_origins_must_be_distinct(self) -> None:
        broken = config_text().replace(
            "https://g1.example.invalid/ar-io/resolver/{name}",
            "https://g0.example.invalid/ar-io/resolver/{name}",
        )
        with self.assertRaisesRegex(MonitoringError, "reuses normalized origin"):
            self.load(broken)

    def test_origin_normalization_canonicalizes_dns_and_ip_spellings(self) -> None:
        self.assertEqual(
            am._normalized_origin("https://BÜCHER.example.", "fixture", {"https"}),
            "https://xn--bcher-kva.example:443",
        )
        self.assertEqual(
            am._normalized_origin(
                "https://[0:0:0:0:0:0:0:1]", "fixture", {"https"}
            ),
            "https://[::1]:443",
        )

    def test_dynamic_gateway_paths_cannot_change_the_origin(self) -> None:
        broken = config_text().replace(
            "https://g0.example.invalid/{txid}/{path}",
            "https://{txid}.g0.example.invalid/{path}",
        )
        with self.assertRaisesRegex(MonitoringError, "outside the URL authority"):
            self.load(broken)

    def test_rpc_operator_and_origin_must_be_distinct(self) -> None:
        duplicate_operator = config_text().replace(
            'operator = "rpc-operator-1"', 'operator = "rpc-operator-0"'
        )
        with self.assertRaisesRegex(MonitoringError, "rpc operator.*duplicated"):
            self.load(duplicate_operator)
        duplicate_origin = config_text().replace(
            "wss://rpc1.example.invalid", "wss://rpc0.example.invalid/other"
        )
        with self.assertRaisesRegex(MonitoringError, "rpc normalized origin.*duplicated"):
            self.load(duplicate_origin)

    def test_plaintext_rpc_is_loopback_only(self) -> None:
        remote = config_text().replace(
            "wss://rpc0.example.invalid", "ws://rpc0.example.invalid"
        )
        with self.assertRaisesRegex(MonitoringError, "plaintext.*loopback"):
            self.load(remote)
        loopback = config_text().replace(
            "wss://rpc0.example.invalid", "ws://127.0.0.1:9944"
        )
        self.assertEqual(self.load(loopback).rpc_endpoints[0].url, "ws://127.0.0.1:9944")

    def test_genesis_and_credential_index_pins_are_required(self) -> None:
        missing_genesis = config_text().replace(
            f'expected_genesis_hash = "0x{"11" * 32}"\n', ""
        )
        with self.assertRaisesRegex(MonitoringError, "operator-supplied fields"):
            self.load(missing_genesis)
        bad_index_digest = config_text().replace("22" * 32, "not-a-digest", 1)
        with self.assertRaisesRegex(MonitoringError, "credential_index_sha256"):
            self.load(bad_index_digest)
        zero_genesis = config_text().replace("11" * 32, "00" * 32, 1)
        with self.assertRaisesRegex(MonitoringError, "all-zero placeholder"):
            self.load(zero_genesis)
        zero_index_digest = config_text().replace("22" * 32, "00" * 32, 1)
        with self.assertRaisesRegex(MonitoringError, "all-zero placeholder"):
            self.load(zero_index_digest)

    def test_operator_signature_minimum_is_required(self) -> None:
        broken = config_text().replace("minimum_release_signatures = 2\n", "")
        with self.assertRaisesRegex(MonitoringError, "operator-supplied"):
            self.load(broken)

    def test_single_release_signature_is_below_the_12_1_4_floor(self) -> None:
        with self.assertRaisesRegex(MonitoringError, r"release-signature floor"):
            self.load(config_text(minimum_signatures=1))

    def test_spec_floor_of_two_release_signatures_is_accepted(self) -> None:
        config = self.load(config_text(minimum_signatures=2))
        self.assertEqual(config.minimum_release_signatures, 2)

    def test_deployment_may_require_more_than_the_floor(self) -> None:
        config = self.load(config_text(minimum_signatures=3))
        self.assertEqual(config.minimum_release_signatures, 3)

    def test_bind_parser_is_crisp(self) -> None:
        self.assertEqual(parse_bind("127.0.0.1:9618"), ("127.0.0.1", 9618))
        with self.assertRaisesRegex(MonitoringError, "HOST:PORT"):
            parse_bind("missing-port")

    def test_keyring_requires_a_stable_organization_for_every_key(self) -> None:
        _, public, key_id = support.keypair(1, 2)
        encoded = support.public_text(public, key_id).splitlines()[1]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "keyring.toml"
            path.write_text(
                f'''generation = 1
[[key]]
role = "attestor"
revocation_index = 0
organization = "builder-org-a"
public_key = "{encoded}"
''',
                encoding="utf-8",
            )
            keyring = am.load_keyring(path)
            self.assertEqual(next(iter(keyring.keys.values())).organization, "builder-org-a")
            path.write_text(
                path.read_text(encoding="utf-8").replace(
                    'organization = "builder-org-a"\n', ""
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(MonitoringError, "organization"):
                am.load_keyring(path)


if __name__ == "__main__":
    unittest.main()
