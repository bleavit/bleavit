from __future__ import annotations

import unittest
from unittest import mock

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import chain_alerts_exporter as exporter_module
from common import MetricStore, MonitoringError


class AssetHubHeadRpc:
    def __init__(self) -> None:
        self.head = "0xasset"
        self.number = 10
        self.genesis = "0x" + "11" * 32

    def call(self, method: str, params: list[object] | None = None) -> object:
        if method == "chain_getFinalizedHead":
            return self.head
        if method == "chain_getBlockHash":
            return self.genesis
        if method == "chain_getHeader":
            return {"number": hex(self.number)}
        raise AssertionError(f"unexpected RPC call {method} {params}")


class MetadataRpc:
    def __init__(self) -> None:
        self.storage_key: str | None = None

    def call(self, method: str, params: list[object] | None = None) -> object:
        if method == "state_getRuntimeVersion":
            return {"specVersion": 7}
        if method == "state_getStorage":
            assert params is not None
            self.storage_key = str(params[0])
            return "0x01"
        raise AssertionError(f"unexpected RPC call {method} {params}")


def value(store: MetricStore, name: str) -> float:
    samples = [sample for (series, _labels), sample in store.values.items() if series == name]
    if len(samples) != 1:
        raise AssertionError(f"expected one {name} sample, found {samples}")
    return samples[0]


class ReserveProbeRunwayTests(unittest.TestCase):
    def test_cli_requires_positive_remote_safety_settings(self) -> None:
        base = [
            "--url", "wss://bleavit.invalid",
            "--asset-hub-url", "wss://asset-hub.invalid",
            "--dot-refill-margin-planck", "1",
            "--asset-hub-stale-seconds", "60",
            "--asset-hub-genesis-hash", "0x" + "11" * 32,
        ]
        args = exporter_module.parse_args(base)
        self.assertEqual(args.dot_refill_margin_planck, 1)
        self.assertEqual(args.asset_hub_stale_seconds, 60)
        stale_index = base.index("60")
        with self.assertRaises(SystemExit):
            exporter_module.parse_args(base[:stale_index] + ["0"] + base[stale_index + 1:])
        for value in ("nan", "inf", "-inf"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                exporter_module.parse_args(base[:stale_index] + [value] + base[stale_index + 1:])
        margin_index = base.index("1")
        with self.assertRaises(SystemExit):
            exporter_module.parse_args(
                base[:margin_index]
                + [str(exporter_module.U128_MAX + 1)]
                + base[margin_index + 1:]
            )

    def exporter(
        self,
        *,
        local: int = 10,
        remote_usdc: object = None,
        remote_dot: object = None,
        remote_asset: object = None,
        fee: int = 3,
        rate: int = 5_000_000_001,
    ) -> tuple[exporter_module.ChainExporter, list[tuple[str, str, tuple[bytes, ...]]]]:
        store = MetricStore(exporter_module.SERIES)
        exporter = exporter_module.ChainExporter(
            object(),
            store,
            asset_hub_rpc=AssetHubHeadRpc(),
            dot_refill_margin_planck=7,
            asset_hub_stale_seconds=60,
            asset_hub_genesis_hash="0x" + "11" * 32,
        )
        params = {
            "ops.probe_fee": fee,
            "ops.probe_rate": rate,
            "res.probe_amount": 11,
            "res.fail_thr": 2,
            "res.recover_thr": 3,
        }
        exporter._runtime_api = lambda *_args: [  # type: ignore[method-assign]
            {"key": list(key.encode()), "value": item} for key, item in params.items()
        ]
        exporter._telemetry_api = lambda *_args: local  # type: ignore[method-assign]
        exporter._storage = lambda *_args: 2000  # type: ignore[method-assign]
        exporter._asset_hub_storage = lambda *_args: 1000  # type: ignore[method-assign]
        calls: list[tuple[str, str, tuple[bytes, ...]]] = []

        def asset_hub_map(
            pallet: str, item: str, keys: tuple[bytes, ...], _block_hash: str
        ) -> object:
            calls.append((pallet, item, keys))
            if item == "Asset":
                return remote_asset if remote_asset is not None else {
                    "status": {"variant": "Live"}
                }
            if pallet == "Assets":
                return remote_usdc
            return remote_dot

        exporter._asset_hub_map = asset_hub_map  # type: ignore[method-assign]
        return exporter, calls

    def test_exact_runway_is_ready_and_uses_canonical_sovereign_and_asset(self) -> None:
        exporter, calls = self.exporter(
            remote_usdc={"balance": 11, "status": {"variant": "Liquid"}},
            remote_dot={"data": {"free": 25, "frozen": 3}},
        )
        exporter._reserve_probe_runway("0xbleavit")

        # ceil(3 * 5_000_000_001 / 1e10) = 2; five envelopes require 10 USDC.
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_local_required_usdc"), 10)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_remote_required_dot_planck"), 22)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_ready"), 1)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 1)
        sovereign = b"sibl" + (2000).to_bytes(4, "little") + bytes(24)
        self.assertEqual(calls[0], ("Assets", "Asset", ((1337).to_bytes(4, "little"),)))
        self.assertEqual(calls[1], ("Assets", "Account", ((1337).to_bytes(4, "little"), sovereign)))
        self.assertEqual(calls[2], ("System", "Account", (sovereign,)))

    def test_each_below_threshold_is_unready_but_collection_remains_healthy(self) -> None:
        cases = (
            {"local": 9, "remote_usdc": {"balance": 11, "status": {"variant": "Liquid"}}, "remote_dot": {"data": {"free": 22, "frozen": 0}}},
            {"local": 10, "remote_usdc": {"balance": 10, "status": {"variant": "Liquid"}}, "remote_dot": {"data": {"free": 22, "frozen": 0}}},
            {"local": 10, "remote_usdc": {"balance": 11, "status": {"variant": "Liquid"}}, "remote_dot": {"data": {"free": 21, "frozen": 0}}},
        )
        for case in cases:
            with self.subTest(case=case):
                exporter, _calls = self.exporter(**case)
                exporter._reserve_probe_runway("0xbleavit")
                self.assertEqual(value(exporter.store, "bleavit_reserve_probe_ready"), 0)
                self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 1)

    def test_absent_remote_accounts_are_observed_zero_not_inferred_healthy(self) -> None:
        exporter, _calls = self.exporter(remote_usdc=None, remote_dot=None)
        exporter._reserve_probe_runway("0xbleavit")
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_remote_usdc"), 0)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_remote_dot_planck"), 0)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_ready"), 0)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 1)

    def test_absent_canonical_asset_definition_is_collection_failure(self) -> None:
        exporter, _calls = self.exporter(
            remote_usdc={"balance": 11, "status": {"variant": "Liquid"}}
        )
        original = exporter._asset_hub_map
        exporter._asset_hub_map = (  # type: ignore[method-assign]
            lambda pallet, item, keys, block_hash:
            None if item == "Asset" else original(pallet, item, keys, block_hash)
        )
        with self.assertRaisesRegex(MonitoringError, "asset definition is absent"):
            exporter._reserve_probe_runway("0xbleavit")

    def test_frozen_account_or_asset_is_not_counted_as_usable_usdc(self) -> None:
        cases = (
            {
                "remote_asset": {"status": {"variant": "Live"}},
                "remote_usdc": {"balance": 99, "status": {"variant": "Frozen"}},
            },
            {
                "remote_asset": {"status": {"variant": "Frozen"}},
                "remote_usdc": {"balance": 99, "status": {"variant": "Liquid"}},
            },
            {
                "remote_asset": {"status": {"variant": "Destroying"}},
                "remote_usdc": {"balance": 99, "status": {"variant": "Liquid"}},
            },
        )
        for case in cases:
            with self.subTest(case=case):
                exporter, _calls = self.exporter(
                    **case, remote_dot={"data": {"free": 99, "frozen": 0}}
                )
                exporter._reserve_probe_runway("0xbleavit")
                self.assertEqual(value(exporter.store, "bleavit_reserve_probe_remote_usdc"), 0)
                self.assertEqual(value(exporter.store, "bleavit_reserve_probe_ready"), 0)
                self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 1)

    def test_decode_failure_clears_readiness_family_and_sets_collection_unhealthy(self) -> None:
        exporter, _calls = self.exporter(
            remote_usdc={"wrong": 11, "status": {"variant": "Liquid"}}
        )
        for family in exporter_module.FULL_DOMAIN_FAMILIES["reserve runway"]:
            exporter.store.set(family, 9)
        complete = exporter._run_domain(
            "reserve runway",
            exporter_module.FULL_DOMAIN_FAMILIES["reserve runway"],
            lambda: exporter._reserve_probe_runway("0xbleavit"),
        )
        self.assertFalse(complete)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 0)
        self.assertNotIn(
            "bleavit_reserve_probe_ready",
            {name for name, _labels in exporter.store.values},
        )

    def test_transport_reconnect_cleanup_clears_stale_ready_samples(self) -> None:
        exporter, _calls = self.exporter()
        for family in exporter_module.FULL_DOMAIN_FAMILIES["reserve runway"]:
            exporter.store.set(family, 9)
        exporter.store.set("bleavit_chain_xcm_trapped_assets", 4)
        exporter_module._clear_reserve_runway_unhealthy(exporter.store)
        self.assertEqual(value(exporter.store, "bleavit_reserve_probe_collection_ok"), 0)
        present = {name for name, _labels in exporter.store.values}
        self.assertNotIn("bleavit_reserve_probe_ready", present)
        self.assertEqual(value(exporter.store, "bleavit_chain_xcm_trapped_assets"), 4)

    def test_checked_arithmetic_rejects_overflow(self) -> None:
        exporter, _calls = self.exporter(fee=exporter_module.U128_MAX, rate=2)
        with self.assertRaises(MonitoringError):
            exporter._reserve_probe_runway("0xbleavit")

    def test_ceil_conversion_handles_exact_division_and_minimum_product(self) -> None:
        exact, _calls = self.exporter(
            fee=2, rate=5_000_000_000,
            remote_usdc={"balance": 99, "status": {"variant": "Liquid"}},
            remote_dot={"data": {"free": 99, "frozen": 0}},
        )
        exact._reserve_probe_runway("0xbleavit")
        self.assertEqual(value(exact.store, "bleavit_reserve_probe_local_required_usdc"), 5)
        minimum, _calls = self.exporter(
            fee=1, rate=1,
            remote_usdc={"balance": 99, "status": {"variant": "Liquid"}},
            remote_dot={"data": {"free": 99, "frozen": 0}},
        )
        minimum._reserve_probe_runway("0xbleavit")
        self.assertEqual(value(minimum.store, "bleavit_reserve_probe_local_required_usdc"), 5)

    def test_unchanged_remote_finalized_head_eventually_fails_closed(self) -> None:
        exporter, _calls = self.exporter(
            remote_usdc={"balance": 11, "status": {"variant": "Liquid"}},
            remote_dot={"data": {"free": 22, "frozen": 0}},
        )
        exporter._reserve_probe_runway("0xbleavit")
        assert exporter.asset_hub_tracker.advanced_at is not None
        exporter.asset_hub_tracker.advanced_at -= 61
        with self.assertRaisesRegex(MonitoringError, "finalized head is stale"):
            exporter._reserve_probe_runway("0xbleavit")

    def test_remote_identity_and_finalized_monotonicity_fail_closed(self) -> None:
        exporter, _calls = self.exporter(
            remote_usdc={"balance": 11, "status": {"variant": "Liquid"}},
            remote_dot={"data": {"free": 22, "frozen": 0}},
        )
        rpc = exporter.asset_hub_rpc
        assert isinstance(rpc, AssetHubHeadRpc)
        rpc.genesis = "0x" + "22" * 32
        with self.assertRaisesRegex(MonitoringError, "genesis hash"):
            exporter._reserve_probe_runway("0xbleavit")
        rpc.genesis = "0x" + "11" * 32
        exporter._reserve_probe_runway("0xbleavit")
        rpc.number = 9
        rpc.head = "0xolder"
        with self.assertRaisesRegex(MonitoringError, "height regressed"):
            exporter._reserve_probe_runway("0xbleavit")
        rpc.number = 10
        rpc.head = "0xother"
        with self.assertRaisesRegex(MonitoringError, "same height"):
            exporter._reserve_probe_runway("0xbleavit")

        other_para, _calls = self.exporter()
        other_para._asset_hub_storage = lambda *_args: 1001  # type: ignore[method-assign]
        with self.assertRaisesRegex(MonitoringError, "canonical Asset Hub para 1000"):
            other_para._reserve_probe_runway("0xbleavit")

    def test_unknown_remote_status_is_malformed_collection(self) -> None:
        for case in (
            {"remote_asset": {"status": {"variant": "Unknown"}}, "remote_usdc": None},
            {
                "remote_asset": {"status": {"variant": "Live"}},
                "remote_usdc": {"balance": 11, "status": {"variant": "Unknown"}},
            },
        ):
            with self.subTest(case=case):
                exporter, _calls = self.exporter(**case)
                with self.assertRaisesRegex(MonitoringError, "unknown status"):
                    exporter._reserve_probe_runway("0xbleavit")

    def test_asset_hub_map_uses_live_prefix_two_concat_hashers_and_value_type(self) -> None:
        rpc = MetadataRpc()
        exporter = exporter_module.ChainExporter(
            object(), asset_hub_rpc=rpc, dot_refill_margin_planck=1,
            asset_hub_stale_seconds=1, asset_hub_genesis_hash="0x" + "11" * 32
        )
        exporter.asset_hub_metadata = {
            "pallets": {
                "Assets": {
                    "storage": {
                        "prefix": "Assets",
                        "entries": {
                            "Account": {
                                "kind": "map",
                                "hashers": ["Blake2_128Concat", "Blake2_128Concat"],
                                "key_type": 4,
                                "value_type": 9,
                            }
                        },
                    }
                }
            },
            "types": {
                1: {"definition": {"kind": "primitive", "primitive": "u32"}},
                2: {"definition": {"kind": "primitive", "primitive": "u8"}},
                3: {"definition": {"kind": "array", "length": 32, "type_id": 2}},
                4: {"definition": {"kind": "tuple", "type_ids": [1, 3]}},
            },
        }
        exporter.asset_hub_metadata_spec_version = 7
        keys = ((1337).to_bytes(4, "little"), bytes(range(32)))
        with mock.patch.object(exporter_module, "decode_typed_bytes", return_value={"balance": 5}) as decode:
            row = exporter._asset_hub_map("Assets", "Account", keys, "0xasset")
        self.assertEqual(row, {"balance": 5})
        # Literal independently pinned from Substrate's Twox128 prefix and
        # Blake2_128Concat map-key definition; do not reuse production helpers.
        self.assertEqual(
            rpc.storage_key,
            "0x682a59d51ab9e48a8c8cc418ff9708d2b99d880ec681799c0cf30e8886371da9"
            "e0956573baada8dd69fae1cff092d73739050000"
            "f39a2cad58411cd49f577e5086b8031f000102030405060708090a0b0c0d0e0f"
            "101112131415161718191a1b1c1d1e1f",
        )
        decode.assert_called_once_with(b"\x01", 9, exporter.asset_hub_metadata)

    def test_asset_hub_map_rejects_metadata_hasher_drift(self) -> None:
        rpc = MetadataRpc()
        exporter = exporter_module.ChainExporter(
            object(), asset_hub_rpc=rpc, dot_refill_margin_planck=1,
            asset_hub_stale_seconds=1, asset_hub_genesis_hash="0x" + "11" * 32
        )
        exporter.asset_hub_metadata = {
            "pallets": {
                "System": {
                    "storage": {
                        "prefix": "System",
                        "entries": {
                            "Account": {
                                "kind": "map",
                                "hashers": ["Twox64Concat"],
                                "key_type": 3,
                                "value_type": 9,
                            }
                        },
                    }
                }
            },
            "types": {
                2: {"definition": {"kind": "primitive", "primitive": "u8"}},
                3: {"definition": {"kind": "array", "length": 32, "type_id": 2}},
            },
        }
        exporter.asset_hub_metadata_spec_version = 7
        with self.assertRaisesRegex(MonitoringError, "unexpected key hashers"):
            exporter._asset_hub_map("System", "Account", (bytes(32),), "0xasset")

    def test_asset_hub_map_rejects_metadata_key_type_drift(self) -> None:
        rpc = MetadataRpc()
        exporter = exporter_module.ChainExporter(
            object(), asset_hub_rpc=rpc, dot_refill_margin_planck=1,
            asset_hub_stale_seconds=1, asset_hub_genesis_hash="0x" + "11" * 32
        )
        exporter.asset_hub_metadata = {
            "pallets": {
                "System": {
                    "storage": {
                        "prefix": "System",
                        "entries": {
                            "Account": {
                                "kind": "map",
                                "hashers": ["Blake2_128Concat"],
                                "key_type": 1,
                                "value_type": 9,
                            }
                        },
                    }
                }
            },
            "types": {
                1: {"definition": {"kind": "primitive", "primitive": "u32"}},
                2: {"definition": {"kind": "primitive", "primitive": "u8"}},
                3: {"definition": {"kind": "array", "length": 32, "type_id": 2}},
            },
        }
        exporter.asset_hub_metadata_spec_version = 7
        with self.assertRaisesRegex(MonitoringError, "unexpected key type"):
            exporter._asset_hub_map("System", "Account", (bytes(32),), "0xasset")

    def test_initial_asset_hub_failure_keeps_local_finalized_loop_alive(self) -> None:
        class LocalRpc:
            def __init__(self) -> None:
                self.polls = 0
                self.subscribed = False

            def subscribe_finalized(self) -> object:
                self.subscribed = True
                return object()

            def next_finalized(self, _subscription: object, *, timeout: float) -> None:
                self.polls += 1
                if self.polls > 1:
                    raise KeyboardInterrupt
                return None

            def call(self, method: str, params: list[object] | None = None) -> object:
                if method == "chain_getFinalizedHead":
                    return "0xlocal"
                if method == "chain_getHeader":
                    return {"number": "0x2a"}
                raise AssertionError(f"unexpected local RPC call {method} {params}")

            def close(self) -> None:
                pass

        class FakeExporter:
            instances: list["FakeExporter"] = []

            def __init__(self, rpc: object, store: MetricStore, **kwargs: object) -> None:
                self.rpc = rpc
                self.store = store
                self.asset_hub_rpc = kwargs["asset_hub_rpc"]
                self.last_event_block: int | None = None
                self.processed: list[tuple[str, int, bool]] = []
                self.__class__.instances.append(self)

            def process_finalized(self, block_hash: str, block: int, *, full: bool) -> None:
                self.processed.append((block_hash, block, full))
                self.last_event_block = block

        local = LocalRpc()

        def connect(url: str) -> object:
            if url == "wss://bleavit.invalid":
                return local
            raise OSError("Asset Hub unavailable")

        args = mock.Mock(
            url="wss://bleavit.invalid",
            asset_hub_url="wss://asset-hub.invalid",
            dot_refill_margin_planck=1,
            asset_hub_stale_seconds=60,
            asset_hub_genesis_hash="0x" + "11" * 32,
            bind="127.0.0.1:0",
            interval=1.0,
            once=False,
        )
        with (
            mock.patch.object(exporter_module, "WsRpc", side_effect=connect),
            mock.patch.object(exporter_module, "ChainExporter", FakeExporter),
            mock.patch.object(exporter_module, "serve_metrics"),
        ):
            self.assertEqual(exporter_module.run(args), 0)

        self.assertTrue(local.subscribed)
        self.assertEqual(FakeExporter.instances[0].processed, [("0xlocal", 42, True)])


if __name__ == "__main__":
    unittest.main()
