from __future__ import annotations

import unittest

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import chain_alerts_exporter as exporter_module
from common import MetricStore, MonitoringError


class NoRpc:
    def call(self, method: str, params: list[object] | None = None) -> object:
        raise AssertionError(f"unexpected RPC call {method} {params}")


def samples(
    exporter: exporter_module.ChainExporter, name: str
) -> dict[tuple[tuple[str, str], ...], float]:
    return {
        labels: value
        for (series, labels), value in exporter.store.values.items()
        if series == name
    }


class StoragePartitionExporterTests(unittest.TestCase):
    def new_exporter(self) -> exporter_module.ChainExporter:
        exporter = exporter_module.ChainExporter(
            NoRpc(), MetricStore(exporter_module.SERIES)  # type: ignore[arg-type]
        )
        exporter._count_prefix = (  # type: ignore[method-assign]
            lambda pallet, item, _block_hash: 7_000
            if (pallet, item) == ("Market", "Markets")
            else 3
        )
        constants = {
            "MaxLiveProposals": 64,
            "MaxIntakeQueue": 64,
            "MaxNonTerminalCohorts": 16,
            "MaxAllStoredMarkets": 17_984,
            "MaxParams": 128,
            "MaxLiveMarkets": 196,
            "MaxLiveExternalMarkets": 128,
            "MaxStoredMarkets": 2_240,
            "MaxStoredExternalMarkets": 15_744,
        }
        exporter._constant = (  # type: ignore[method-assign]
            lambda _pallet, name, _block_hash: constants[name]
        )
        values = {
            "ActiveMarketCount": 100,
            "ActiveExternalMarketCount": 80,
            "StoredExternalMarketCount": 6_000,
        }
        exporter._storage = (  # type: ignore[method-assign]
            lambda _pallet, item, _block_hash: values[item]
        )
        return exporter

    def test_market_physical_and_logical_partitions_have_independent_bounds(self) -> None:
        exporter = self.new_exporter()

        exporter._storage_counts("0x01")

        entries = samples(exporter, "bleavit_chain_storage_map_entries")
        bounds = samples(exporter, "bleavit_chain_storage_map_bound")
        expected = {
            "Markets": (7_000, 17_984),
            "ActiveMarketCount": (100, 196),
            "ActiveExternalMarketCount": (80, 128),
            "StoredPrimaryMarketCount": (1_000, 2_240),
            "StoredExternalMarketCount": (6_000, 15_744),
        }
        for item, (entry, bound) in expected.items():
            labels = (("pallet", "Market"), ("item", item))
            self.assertEqual(entries[labels], entry)
            self.assertEqual(bounds[labels], bound)

    def test_inconsistent_market_partition_fails_closed(self) -> None:
        exporter = self.new_exporter()
        exporter._storage = (  # type: ignore[method-assign]
            lambda _pallet, item, _block_hash: {
                "ActiveMarketCount": 100,
                "ActiveExternalMarketCount": 80,
                "StoredExternalMarketCount": 7_001,
            }[item]
        )

        with self.assertRaisesRegex(MonitoringError, "partition counters"):
            exporter._storage_counts("0x01")

    def test_odd_live_external_book_count_fails_closed(self) -> None:
        exporter = self.new_exporter()
        exporter._storage = (  # type: ignore[method-assign]
            lambda _pallet, item, _block_hash: {
                "ActiveMarketCount": 100,
                "ActiveExternalMarketCount": 79,
                "StoredExternalMarketCount": 6_000,
            }[item]
        )

        with self.assertRaisesRegex(MonitoringError, "partition counters"):
            exporter._storage_counts("0x01")


if __name__ == "__main__":
    unittest.main()
