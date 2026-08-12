from __future__ import annotations

import copy
import unittest

from support import FINAL_MANIFEST_TXID, integrity_fixture, release_channel_bytes

import attestation_monitor as am


def evaluate(fixture: dict, **overrides):
    arguments = {
        "files": fixture["files"],
        "expected_hashes": fixture["hashes"],
        "release_json_bytes": fixture["release_raw"],
        "release_document": fixture["document"],
        "release_signatures": fixture["signatures"],
        "attestations": fixture["attestations"],
        "keyring": fixture["keyring"],
        "release_channel_bytes": fixture["channel"],
        "resolved_txids": fixture["resolved"],
        "minimum_release_signatures": 1,
    }
    arguments.update(overrides)
    return am.evaluate_integrity(**arguments)


class AttestationVerdictTests(unittest.TestCase):
    def test_resolver_consensus_requires_a_strict_majority(self) -> None:
        self.assertEqual(am.resolver_consensus(["A", "A", "B"]), "A")
        self.assertIsNone(am.resolver_consensus(["A", "B", "C"]))
        self.assertIsNone(am.resolver_consensus(["A", "A", "B", "B"]))

    def test_complete_fixture_is_healthy(self) -> None:
        verdict = evaluate(integrity_fixture())
        self.assertTrue(verdict.ok, verdict.errors)
        self.assertEqual(verdict.valid_release_signatures, 1)
        self.assertEqual(verdict.valid_attestations, 2)

    def test_byte_mismatch_fixture(self) -> None:
        fixture = integrity_fixture()
        files = dict(fixture["files"])
        files["app.js"] += b"tamper"
        verdict = evaluate(fixture, files=files)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.byte_mismatches, 1)
        self.assertTrue(any("app.js" in error for error in verdict.errors))

    def test_unlisted_served_file_is_a_mismatch(self) -> None:
        fixture = integrity_fixture()
        files = dict(fixture["files"])
        files["evil.js"] = b"evil"
        verdict = evaluate(fixture, files=files)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.byte_mismatches, 1)

    def test_missing_attestations_fixture(self) -> None:
        fixture = integrity_fixture()
        verdict = evaluate(fixture, attestations=fixture["attestations"][:1])
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.valid_attestations, 1)

    def test_wrong_keyring_generation_fixture(self) -> None:
        fixture = integrity_fixture()
        wrong = am.Keyring(8, fixture["keyring"].keys)
        verdict = evaluate(fixture, keyring=wrong)
        self.assertFalse(verdict.ok)
        self.assertTrue(any("generation" in error for error in verdict.errors))

    def test_revoked_release_key_bit_fixture(self) -> None:
        fixture = integrity_fixture()
        channel = release_channel_bytes(
            release_json_hash=fixture["channel"][76:108], revoked=1 << 0
        )
        verdict = evaluate(fixture, release_channel_bytes=channel)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.valid_release_signatures, 0)

    def test_revoked_attestor_key_bit_fixture(self) -> None:
        fixture = integrity_fixture()
        channel = release_channel_bytes(
            release_json_hash=fixture["channel"][76:108], revoked=1 << 1
        )
        verdict = evaluate(fixture, release_channel_bytes=channel)
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.valid_attestations, 1)

    def test_asset_and_final_manifest_addresses_cannot_collapse(self) -> None:
        fixture = integrity_fixture()
        document = copy.deepcopy(fixture["document"])
        document["arweaveManifestTxId"] = FINAL_MANIFEST_TXID
        verdict = evaluate(fixture, release_document=document)
        self.assertFalse(verdict.ok)
        self.assertTrue(
            any("asset manifest equals the final" in error for error in verdict.errors)
        )

    def test_two_of_three_gateway_resolver_divergence_fixture(self) -> None:
        fixture = integrity_fixture()
        verdict = evaluate(
            fixture,
            resolved_txids=["B" * 43, "B" * 43, FINAL_MANIFEST_TXID],
        )
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.resolver_divergent_gateways, 2)

    def test_one_of_three_resolver_difference_fails_integrity(self) -> None:
        fixture = integrity_fixture()
        verdict = evaluate(
            fixture,
            resolved_txids=["B" * 43, FINAL_MANIFEST_TXID, FINAL_MANIFEST_TXID],
        )
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.resolver_divergent_gateways, 1)

    def test_two_attestor_keys_from_one_organization_count_once(self) -> None:
        fixture = integrity_fixture()
        keys = dict(fixture["keyring"].keys)
        attestors = [record for record in keys.values() if record.role == "attestor"]
        replacement = attestors[1]
        keys[replacement.key_id] = am.KeyRecord(
            replacement.key_id,
            replacement.public_key,
            replacement.role,
            replacement.revocation_index,
            attestors[0].organization,
        )
        verdict = evaluate(fixture, keyring=am.Keyring(7, keys))
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.valid_attestations, 1)
        self.assertTrue(any("organizations 1 < 2" in error for error in verdict.errors))

    def test_non_covering_release_fixture(self) -> None:
        fixture = integrity_fixture()
        document = copy.deepcopy(fixture["document"])
        document["specVersionRange"] = {"primary": 1, "recovery": 2}
        verdict = evaluate(fixture, release_document=document)
        self.assertFalse(verdict.ok)
        self.assertFalse(verdict.covering_release)

    def test_release_file_map_rejects_normalization_aliases(self) -> None:
        fixture = integrity_fixture()
        for path in ("assets//app.js", "assets/../app.js", "./app.js", "app.js/"):
            with self.subTest(path=path):
                document = copy.deepcopy(fixture["document"])
                document["perFileHashes"] = {path: "a" * 64}
                with self.assertRaisesRegex(am.MonitoringError, "unsafe path"):
                    am.parse_app_release(document)

    def test_operator_release_signature_threshold_is_not_silently_defaulted(self) -> None:
        fixture = integrity_fixture()
        verdict = evaluate(fixture, minimum_release_signatures=2)
        self.assertFalse(verdict.ok)
        self.assertTrue(any("operator minimum 2" in error for error in verdict.errors))


if __name__ == "__main__":
    unittest.main()
