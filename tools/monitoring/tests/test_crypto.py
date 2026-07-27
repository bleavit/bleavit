from __future__ import annotations

import base64
import unittest

from support import keypair, minisign_text, public_text

import attestation_monitor as am


class CryptoTests(unittest.TestCase):
    def test_rfc8032_vector_one(self) -> None:
        public = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        signature = bytes.fromhex(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        )
        self.assertTrue(am.ed25519_verify(public, b"", signature))
        self.assertFalse(am.ed25519_verify(public, b"x", signature))

    def test_minisign_legacy_ed_vector(self) -> None:
        seed, public, key_id = keypair(1, 2)
        parsed = am.parse_minisign_public_key(public_text(public, key_id))
        signature = minisign_text(seed, public, key_id, b"legacy", b"Ed")
        self.assertTrue(am.verify_minisign(b"legacy", signature, parsed))
        self.assertFalse(am.verify_minisign(b"tampered", signature, parsed))

    def test_minisign_prehashed_ed_vector(self) -> None:
        seed, public, key_id = keypair(3, 4)
        parsed = am.parse_minisign_public_key(public_text(public, key_id))
        signature = minisign_text(seed, public, key_id, b"prehashed", b"ED")
        self.assertTrue(am.verify_minisign(b"prehashed", signature, parsed))

    def test_trusted_comment_is_authenticated(self) -> None:
        seed, public, key_id = keypair(5, 6)
        parsed = am.parse_minisign_public_key(public_text(public, key_id))
        signature = minisign_text(seed, public, key_id, b"message")
        self.assertFalse(am.verify_minisign(b"message", signature.replace("file:fixture", "file:other"), parsed))

    def test_wrong_key_id_is_rejected(self) -> None:
        seed, public, key_id = keypair(7, 8)
        _, other_public, other_id = keypair(9, 10)
        signature = minisign_text(seed, public, key_id, b"message")
        self.assertFalse(
            am.verify_minisign(
                b"message",
                signature,
                am.parse_minisign_public_key(public_text(other_public, other_id)),
            )
        )

    def test_canonical_small_order_points_are_rejected(self) -> None:
        """Regression (audit 2026-07-27, AUD-2).

        `_decode_point` compared `8*P` to `IDENTITY` with `==` on the extended
        projective 4-tuple. `8*P` for a small-order P is a NON-normalized
        representative of the identity — (0, k, k, 0), k != 1 — so the tuple
        comparison never matched and every small-order point was accepted,
        against this module's own "strict RFC 8032" claim. All four canonical
        small-order encodings must be refused.
        """
        for name, encoded in (
            ("order 1", "01" + "00" * 31),
            ("order 2", "ec" + "ff" * 30 + "7f"),
            ("order 4", "00" * 31 + "80"),
            (
                "order 8",
                "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
            ),
        ):
            with self.subTest(point=name):
                with self.assertRaisesRegex(ValueError, "small-order"):
                    am._decode_point(bytes.fromhex(encoded))

    def test_small_order_public_key_never_verifies(self) -> None:
        """The decode refusal must surface as a verification failure, not a raise."""
        small_order = bytes.fromhex("ec" + "ff" * 30 + "7f")
        self.assertFalse(am.ed25519_verify(small_order, b"", b"\x00" * 64))

    def test_malformed_minisign_packet_is_rejected(self) -> None:
        malformed = "untrusted comment: x\n" + base64.b64encode(b"short").decode() + "\ntrusted comment: x\n" + base64.b64encode(b"x" * 64).decode()
        with self.assertRaisesRegex(ValueError, "packet"):
            am.parse_minisign_signature(malformed)


if __name__ == "__main__":
    unittest.main()
