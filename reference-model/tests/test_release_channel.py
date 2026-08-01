"""Executes 12 §2.3 and §3.1–§3.2 against 02 §12's frozen prefix."""

from __future__ import annotations

import unittest
from dataclasses import replace

from bleavit_reference_model.release_channel import (
    BITS_PER_BYTE,
    EXPEDITED,
    KNOWN_FLAGS,
    RELEASE_CHANNEL_PREFIX_BYTES,
    REVOCATION_INDEX_CAPACITY,
    REVOCATION_MASK_BYTES,
    SECURITY,
    URGENT_UPGRADE,
    AppState,
    Banner,
    ChannelRecord,
    Keyring,
    SemVer,
    check_revocation_persistence,
    documented_revocation,
    key_refused,
    read_channel,
)


TXID_A = "A" * 43
TXID_B = "B" * 43


def ring(generation: int) -> Keyring:
    return Keyring(generation, (f"release-{generation}", f"other-{generation}"))


def app(generation: int = 7, **overrides: object) -> AppState:
    values: dict[str, object] = {
        "own_version": "1.2.3",
        "own_manifest_txid": TXID_A,
        "own_generation": generation,
        "own_key_indices": frozenset({0}),
        "shipped_keyrings": tuple(ring(item) for item in range(6, generation + 1)),
    }
    values.update(overrides)
    return AppState(**values)  # type: ignore[arg-type]


def record(generation: int = 7, **overrides: object) -> ChannelRecord:
    values: dict[str, object] = {
        "version": "1.2.3",
        "manifest_txid": TXID_A,
        "min_supported_version": "1.0.0",
        "keyring_generation": generation,
        "revoked_key_bits": 0,
    }
    values.update(overrides)
    return ChannelRecord(**values)  # type: ignore[arg-type]


class FrozenLayoutTests(unittest.TestCase):
    """Figures derived directly from 02 §12's offsets and widths."""

    def test_frozen_prefix_and_revocation_capacity_reproduce_exactly(self) -> None:
        self.assertEqual(RELEASE_CHANNEL_PREFIX_BYTES, 168)
        self.assertEqual(REVOCATION_MASK_BYTES, 8)
        self.assertEqual(REVOCATION_MASK_BYTES * BITS_PER_BYTE, 64)
        self.assertEqual(REVOCATION_INDEX_CAPACITY, 64)

    def test_append_only_future_prefix_is_read_but_truncation_is_degraded(self) -> None:
        extended = read_channel(
            record(schema=2, byte_length=RELEASE_CHANNEL_PREFIX_BYTES + 17), app()
        )
        self.assertTrue(extended.interpreted)
        truncated = read_channel(
            record(byte_length=RELEASE_CHANNEL_PREFIX_BYTES - 1), app()
        )
        self.assertEqual(truncated.banner, Banner.DEGRADED)
        self.assertFalse(truncated.signing_enabled)
        self.assertIn("truncated", truncated.degraded_reason or "")

    def test_reserved_bits_and_malformed_fields_are_never_healthy(self) -> None:
        malformed = (
            record(flags=1 << 3),
            record(version="01.2.3"),
            record(manifest_txid="not-a-txid"),
            record(revoked_key_bits=1 << REVOCATION_INDEX_CAPACITY),
            record(schema=0),
        )
        for candidate in malformed:
            with self.subTest(candidate=candidate):
                verdict = read_channel(candidate, app())
                self.assertFalse(verdict.healthy)
                self.assertEqual(verdict.banner, Banner.DEGRADED)
                self.assertIsNone(verdict.newer_release_exists)
                self.assertIsNone(verdict.security_flag_set)

    def test_semver_precedence_not_lexicographic_order_drives_the_reader(self) -> None:
        self.assertGreater(SemVer.parse("1.10.0"), SemVer.parse("1.9.0"))
        self.assertLess(SemVer.parse("2.0.0-rc.1"), SemVer.parse("2.0.0"))
        verdict = read_channel(record(version="1.10.0", manifest_txid=TXID_B), app())
        self.assertEqual(verdict.banner, Banner.NEWER_RELEASE)


class ReaderStateSpaceTests(unittest.TestCase):
    """Every cross-generation cell obeys §3.1's no-healthy-unknown rule."""

    def test_no_uninterpretable_cell_renders_affirmative_health(self) -> None:
        masks = (0, 1 << 0, 1 << 1)
        for own_generation in (6, 7, 8):
            installed = app(own_generation)
            for channel_generation in (6, 7, 8):
                for mask in masks:
                    for flags in range(KNOWN_FLAGS + 1):
                        if flags & ~KNOWN_FLAGS:
                            continue
                        with self.subTest(
                            own=own_generation,
                            channel=channel_generation,
                            mask=mask,
                            flags=flags,
                        ):
                            verdict = read_channel(
                                record(
                                    channel_generation,
                                    revoked_key_bits=mask,
                                    flags=flags,
                                ),
                                installed,
                            )
                            future_generation = channel_generation > own_generation
                            if future_generation:
                                self.assertEqual(verdict.banner, Banner.DEGRADED)
                                self.assertFalse(verdict.healthy)
                                self.assertFalse(verdict.signing_enabled)
                                self.assertIsNone(verdict.newer_release_exists)
                                self.assertIsNone(verdict.security_flag_set)
                            else:
                                self.assertTrue(verdict.interpreted)

    def test_newer_banner_requires_both_newer_version_and_different_txid(self) -> None:
        same_txid = read_channel(record(version="1.2.4"), app())
        same_version = read_channel(record(manifest_txid=TXID_B), app())
        both = read_channel(record(version="1.2.4", manifest_txid=TXID_B), app())
        self.assertFalse(same_txid.newer_release_exists)
        self.assertFalse(same_version.newer_release_exists)
        self.assertEqual(both.banner, Banner.NEWER_RELEASE)
        self.assertTrue(both.newer_release_exists)

    def test_minimum_version_warning_gates_signing_until_acknowledged(self) -> None:
        channel = record(min_supported_version="1.2.4")
        before = read_channel(channel, app())
        after = read_channel(channel, replace(app(), warning_acknowledged=True))
        self.assertEqual(before.banner, Banner.BLOCKING)
        self.assertTrue(before.blocking)
        self.assertTrue(before.requires_acknowledgment)
        self.assertFalse(before.signing_enabled)
        self.assertTrue(after.signing_enabled)

    def test_security_disables_signing_only_when_a_section_3_2_clause_applies(self) -> None:
        own_key = read_channel(record(flags=SECURITY, revoked_key_bits=1 << 0), app())
        other_key = read_channel(record(flags=SECURITY, revoked_key_bits=1 << 1), app())
        old_version = read_channel(
            record(flags=SECURITY, min_supported_version="1.2.4"), app()
        )
        self.assertEqual(own_key.banner, Banner.SECURITY)
        self.assertFalse(own_key.signing_enabled)
        self.assertEqual(own_key.revoked_own_key_ids, frozenset({"release-7"}))
        self.assertTrue(other_key.signing_enabled)
        self.assertTrue(other_key.security_flag_set)
        self.assertFalse(other_key.healthy)
        self.assertEqual(old_version.banner, Banner.SECURITY)
        self.assertFalse(old_version.signing_enabled)

    def test_expedited_and_urgent_bits_do_not_invent_a_section_3_2_banner(self) -> None:
        verdict = read_channel(record(flags=EXPEDITED | URGENT_UPGRADE), app())
        self.assertEqual(verdict.banner, Banner.NONE)
        self.assertTrue(verdict.signing_enabled)


class RevocationPersistenceTests(unittest.TestCase):
    """The historical-key MUST in 12 §1.3, executed over generation changes."""

    def test_sq_551_generation_bump_retargets_the_bit_to_the_new_keyring(self) -> None:
        """SQ-551. Sections 2.3 and 1.3 require permanent refusal; the layout cannot.

        The procedure bumps generation 7 to 8 and sets old index 0.  Because 02
        §12 scopes the mask to generation 8, it revokes ``replacement-8`` and
        does not revoke ``compromised``.  Every later generation that omits the
        compromised identity therefore accepts its historical signature.
        """
        generation_7 = Keyring(7, ("compromised", "steady"))
        baseline = record(7)
        revoked = documented_revocation(baseline, compromised_index=0)
        later_records = tuple(
            replace(revoked, keyring_generation=generation) for generation in range(8, 12)
        )
        later_keyrings = tuple(
            Keyring(generation, (f"replacement-{generation}", "steady"))
            for generation in range(8, 12)
        )
        published = (generation_7,) + later_keyrings

        self.assertEqual(revoked.keyring_generation, 8)
        self.assertEqual(revoked.revoked_key_bits, 1)
        for candidate in later_records:
            with self.subTest(generation=candidate.keyring_generation):
                self.assertFalse(key_refused(candidate, "compromised", published))
                self.assertTrue(
                    key_refused(
                        candidate,
                        f"replacement-{candidate.keyring_generation}",
                        published,
                    )
                )
        finding = check_revocation_persistence(
            "compromised", later_records, published
        )[0]
        self.assertEqual(
            finding.key, "revoked key remains refused across later generations"
        )
        self.assertFalse(finding.ok)

    def test_relisting_every_historical_key_is_the_only_encoding_rescue(self) -> None:
        revoked = documented_revocation(record(7), compromised_index=0)
        relisted = Keyring(8, ("compromised", "replacement"))
        omitted = Keyring(8, ("replacement",))
        self.assertTrue(key_refused(revoked, "compromised", (relisted,)))
        self.assertFalse(key_refused(revoked, "compromised", (omitted,)))

    def test_relisting_rescue_caps_lifetime_remembered_keys_at_64(self) -> None:
        fitting = Keyring(99, tuple(f"revoked-{index}" for index in range(64)))
        overflowing = Keyring(99, tuple(f"revoked-{index}" for index in range(65)))
        self.assertIsNone(fitting.validation_error())
        self.assertIn("64 indices", overflowing.validation_error() or "")
        self.assertEqual(REVOCATION_INDEX_CAPACITY, 64)

    def test_a_stranded_app_cannot_interpret_the_bumped_generation(self) -> None:
        revoked = documented_revocation(record(7), compromised_index=0)
        stranded = app(
            7,
            shipped_keyrings=(Keyring(7, ("compromised", "steady")),),
        )
        verdict = read_channel(revoked, stranded)
        self.assertEqual(verdict.banner, Banner.DEGRADED)
        self.assertFalse(verdict.signing_enabled)
        self.assertFalse(verdict.healthy)
        self.assertIn("generation 8", verdict.degraded_reason or "")


if __name__ == "__main__":
    unittest.main()
