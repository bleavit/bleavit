from __future__ import annotations

import unittest

from support import release_channel_bytes

import attestation_monitor as am
from common import MonitoringError, RELEASE_CHANNEL_KEY


GENESIS = "0x" + "11" * 32
FINALIZED = "0x" + "22" * 32


class FakeRpc:
    def __init__(
        self,
        *,
        genesis: str = GENESIS,
        finalized: str = FINALIZED,
        block: int = 100,
        channel: bytes | None = None,
    ):
        self.genesis = genesis
        self.finalized = finalized
        self.block = block
        self.channel = channel or release_channel_bytes()

    def call(self, method: str, params=()):
        if method == "chain_getBlockHash":
            self._equal(params, [0])
            return self.genesis
        if method == "chain_getFinalizedHead":
            return self.finalized
        if method == "chain_getHeader":
            self._equal(params, [self.finalized])
            return {"number": hex(self.block)}
        if method == "state_getStorage":
            self._equal(params, [RELEASE_CHANNEL_KEY, self.finalized])
            return "0x" + self.channel.hex()
        raise AssertionError(f"unexpected RPC method {method}")

    def _equal(self, actual, expected) -> None:
        if list(actual) != expected:
            raise AssertionError(f"{actual!r} != {expected!r}")


def connections(*rpcs: FakeRpc):
    return [
        (am.RpcEndpoint(f"operator-{index}", f"wss://rpc{index}.invalid"), rpc)
        for index, rpc in enumerate(rpcs)
    ]


class RpcQuorumTests(unittest.TestCase):
    def test_three_operator_exact_agreement_is_accepted(self) -> None:
        channel = release_channel_bytes()
        observation = am.read_rpc_quorum(
            connections(
                FakeRpc(channel=channel),
                FakeRpc(channel=channel),
                FakeRpc(channel=channel),
            ),
            GENESIS,
        )
        self.assertEqual(observation.block_hash, FINALIZED)
        self.assertEqual(observation.block_number, 100)
        self.assertEqual(observation.release_channel_bytes, channel)

    def test_wrong_genesis_fails_before_channel_is_trusted(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "genesis hash differs"):
            am.read_rpc_quorum(
                connections(
                    FakeRpc(),
                    FakeRpc(genesis="0x" + "99" * 32),
                    FakeRpc(),
                ),
                GENESIS,
            )

    def test_any_finalized_hash_or_channel_disagreement_fails(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "quorum disagreement"):
            am.read_rpc_quorum(
                connections(
                    FakeRpc(),
                    FakeRpc(finalized="0x" + "33" * 32),
                    FakeRpc(),
                ),
                GENESIS,
            )
        different = bytearray(release_channel_bytes())
        different[108] ^= 1
        with self.assertRaisesRegex(MonitoringError, "quorum disagreement"):
            am.read_rpc_quorum(
                connections(
                    FakeRpc(),
                    FakeRpc(channel=bytes(different)),
                    FakeRpc(),
                ),
                GENESIS,
            )

    def test_less_than_three_endpoints_is_never_a_quorum(self) -> None:
        with self.assertRaisesRegex(MonitoringError, "at least three"):
            am.read_rpc_quorum(connections(FakeRpc(), FakeRpc()), GENESIS)


if __name__ == "__main__":
    unittest.main()
