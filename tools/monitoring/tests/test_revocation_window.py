"""Co-simulates 12 §2.3's revocation window against the shipped monitor."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from dataclasses import dataclass
from typing import Any

from support import (
    integrity_fixture,
    keypair,
    minisign_text,
    public_text,
    release_channel_bytes,
)

import attestation_monitor as am


SECURITY = 1 << 0
COMPROMISED_INDEX = 3


def evaluate(fixture: dict[str, Any]) -> am.IntegrityVerdict:
    return am.evaluate_integrity(
        files=fixture["files"],
        expected_hashes=fixture["hashes"],
        release_json_bytes=fixture["release_raw"],
        release_document=fixture["document"],
        release_signatures=fixture["signatures"],
        attestations=fixture["attestations"],
        keyring=fixture["keyring"],
        release_channel_bytes=fixture["channel"],
        resolved_txids=fixture["resolved"],
        minimum_release_signatures=1,
    )


def _with_historical_compromised_key(fixture: dict[str, Any]) -> bytes:
    """Add a generation-7 key that did not sign the current production release."""
    _, public, key_id = keypair(14, 24)
    parsed = am.parse_minisign_public_key(public_text(public, key_id))
    keys = dict(fixture["keyring"].keys)
    keys[key_id] = am.KeyRecord(
        key_id,
        parsed,
        "release",
        COMPROMISED_INDEX,
        "release-org-b",
    )
    fixture["keyring"] = am.Keyring(7, keys)
    return key_id


def _publish_generation_8(fixture: dict[str, Any], compromised_id: bytes) -> dict[str, Any]:
    """Perform §2.3 step 3 as a release-metadata-only next release."""
    published = copy.deepcopy(fixture)
    document = copy.deepcopy(fixture["document"])
    document["keyringGeneration"] = 8
    release_raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    message = hashlib.sha256(release_raw).digest()

    signatures: list[str] = []
    attestations: list[str] = []
    for seed_byte, id_byte, role in (
        (11, 21, "release"),
        (12, 22, "attestor"),
        (13, 23, "attestor"),
    ):
        seed, public, key_id = keypair(seed_byte, id_byte)
        blob = minisign_text(seed, public, key_id, message)
        (signatures if role == "release" else attestations).append(blob)

    active_keys = {
        key_id: key for key_id, key in fixture["keyring"].keys.items()
        if key_id != compromised_id
    }
    published.update(
        {
            "document": document,
            "release_raw": release_raw,
            "signatures": signatures,
            "attestations": attestations,
            "keyring": am.Keyring(8, active_keys),
            "channel": release_channel_bytes(
                release_json_hash=hashlib.sha256(release_raw).digest(),
                generation=8,
                revoked=1 << COMPROMISED_INDEX,
                flags=SECURITY,
                updated_at=200,
            ),
        }
    )
    return published


@dataclass(frozen=True)
class RevocationWindowStep:
    name: str
    lawful: bool
    verdict: am.IntegrityVerdict

    @property
    def false_page(self) -> bool:
        """Failure with neither §6.3 release-integrity threshold condition."""
        return (
            self.lawful
            and not self.verdict.ok
            and self.verdict.byte_mismatches == 0
            and self.verdict.resolver_divergent_gateways == 0
        )


@dataclass(frozen=True)
class RevocationWindowFinding:
    key: str
    ok: bool
    detail: str


def revocation_window_steps() -> tuple[RevocationWindowStep, ...]:
    """Execute §2.3 steps 1–3 around two finalized heads in the window."""
    fixture = integrity_fixture()
    compromised_id = _with_historical_compromised_key(fixture)
    baseline = RevocationWindowStep("baseline", True, evaluate(fixture))

    # §2.3 step 1: bump 7 -> 8 and set the old key's index. Step 3 has not
    # happened, so the current signed release and its shipped keyring remain 7.
    for_window = copy.deepcopy(fixture)
    for_window["channel"] = release_channel_bytes(
        release_json_hash=fixture["channel"][76:108],
        generation=8,
        revoked=1 << COMPROMISED_INDEX,
        flags=SECURITY,
        updated_at=101,
    )
    observed = RevocationWindowStep(
        "revocation observed at finalized head", True, evaluate(for_window)
    )

    # §2.3 step 2 is an app/verifier obligation, not a second channel write.
    # A later finalized head before "the next release" therefore has the same
    # lawful cross-generation state and must not turn into a distribution page.
    later_window = copy.deepcopy(for_window)
    later_window["channel"] = release_channel_bytes(
        release_json_hash=fixture["channel"][76:108],
        generation=8,
        revoked=1 << COMPROMISED_INDEX,
        flags=SECURITY,
        updated_at=150,
    )
    still_waiting = RevocationWindowStep(
        "later finalized head before next release", True, evaluate(later_window)
    )

    # §2.3 step 3 finally publishes generation 8. Step 4 does not apply: the
    # compromised historical key did not sign the current production release.
    published = _publish_generation_8(fixture, compromised_id)
    next_release = RevocationWindowStep(
        "next release publishes generation 8", True, evaluate(published)
    )
    return baseline, observed, still_waiting, next_release


def check_revocation_window() -> tuple[RevocationWindowFinding, ...]:
    """Make the alert-clean procedure claim a queryable SQ-551 value."""
    steps = revocation_window_steps()
    failures = tuple(step.name for step in steps if step.lawful and not step.verdict.ok)
    return (
        RevocationWindowFinding(
            "lawful §2.3 revocation sequence is release-integrity alert-clean",
            not failures,
            ", ".join(failures) if failures else "all lawful steps healthy",
        ),
    )


class RevocationWindowTests(unittest.TestCase):
    def test_sq_551_lawful_revocation_false_pages_until_the_next_release(self) -> None:
        """SQ-551. Section 2.3's lawful window is not a §6.3 integrity mismatch.

        Step 1 requires the channel to move to generation 8, while step 3 defers
        publication of that keyring until the next release.  The monitor demands
        all three generations equal and therefore reports failure at every head
        in between, driving the page-severity RB-RELEASE alert despite zero byte
        mismatches and no resolver divergence.
        """
        baseline, observed, still_waiting, next_release = revocation_window_steps()
        self.assertTrue(baseline.verdict.ok, baseline.verdict.errors)
        for step in (observed, still_waiting):
            with self.subTest(step=step.name):
                self.assertFalse(step.verdict.ok)
                self.assertEqual(
                    step.verdict.errors,
                    ("release/keyring/ReleaseChannel generation mismatch",),
                )
                self.assertEqual(step.verdict.byte_mismatches, 0)
                self.assertEqual(step.verdict.resolver_divergent_gateways, 0)
                self.assertTrue(step.false_page)
        self.assertTrue(next_release.verdict.ok, next_release.verdict.errors)
        finding = check_revocation_window()[0]
        self.assertEqual(
            finding.key,
            "lawful §2.3 revocation sequence is release-integrity alert-clean",
        )
        self.assertFalse(finding.ok)


if __name__ == "__main__":
    unittest.main()
