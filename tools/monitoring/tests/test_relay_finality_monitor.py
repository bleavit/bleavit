from __future__ import annotations

import contextlib
import io
import logging
import re
import unittest
from pathlib import Path
from typing import Any

import support  # noqa: F401 - inserts tools/monitoring on sys.path.

import relay_finality_monitor as monitor
from common import MetricStore, MonitoringError


ROOT = Path(__file__).resolve().parents[3]
RULES = ROOT / "deploy" / "monitoring" / "prometheus" / "rules" / "bleavit-alerts.yml"
DOC = ROOT / "docs" / "architecture" / "12-release-and-operations.md"


def setUpModule() -> None:
    # The exporter logs every degradation and stall by design; keep the suite quiet.
    logging.disable(logging.CRITICAL)


def tearDownModule() -> None:
    logging.disable(logging.NOTSET)


def header(number: int) -> dict[str, str]:
    return {"number": hex(number)}


class FakeRpc:
    """Minimal chain_getHeader / chain_getFinalizedHead stand-in."""

    def __init__(self, best: int, finalized: int) -> None:
        self.best = best
        self.finalized = finalized
        self.fail_on: str | None = None
        self.finalized_hash: Any = "0xfeed"

    def call(self, method: str, params: Any = ()) -> Any:
        if self.fail_on == method:
            raise MonitoringError(f"{method} failed")
        if method == "chain_getFinalizedHead":
            return self.finalized_hash
        if method == "chain_getHeader":
            return header(self.finalized if list(params) else self.best)
        raise AssertionError(f"unexpected method {method}")


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def store_value(store: MetricStore, name: str) -> float | None:
    return store.values.get((name, ()))


def new_monitor(clock: Clock) -> tuple[MetricStore, monitor.RelayFinalityMonitor]:
    store = MetricStore(monitor.SERIES)
    return store, monitor.RelayFinalityMonitor(store, clock=clock)


class StagnationAccountingTests(unittest.TestCase):
    def test_first_observation_anchors_at_zero(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        self.assertTrue(subject.poll(FakeRpc(best=120, finalized=118)))
        self.assertEqual(store_value(store, "bleavit_relay_finality_stagnation_seconds"), 0.0)
        self.assertEqual(store_value(store, "bleavit_relay_best_block"), 120)
        self.assertEqual(store_value(store, "bleavit_relay_finalized_block"), 118)
        self.assertEqual(store_value(store, "bleavit_relay_monitor_connected"), 1)

    def test_stagnation_accumulates_while_finalized_is_flat(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=120, finalized=118)
        subject.poll(rpc)
        for elapsed in (30.0, 120.0, 900.0):
            clock.advance(elapsed)
            rpc.best += 5  # the relay keeps producing; GRANDPA does not follow.
            subject.poll(rpc)
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 1050.0
        )
        self.assertEqual(store_value(store, "bleavit_relay_finalized_block"), 118)

    def test_stagnation_resets_on_finalized_increase(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=200, finalized=190)
        subject.poll(rpc)
        clock.advance(2_400.0)
        subject.poll(rpc)
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 2_400.0
        )
        rpc.finalized = 191
        subject.poll(rpc)
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 0.0
        )
        clock.advance(60.0)
        subject.poll(rpc)
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 60.0
        )

    def test_lagging_failover_endpoint_cannot_conceal_a_stall(self) -> None:
        """A lower finalized height re-reads as stagnation, never as a reset."""
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=500, finalized=480)
        subject.poll(rpc)
        clock.advance(1_900.0)
        rpc.finalized = 470  # failover to a node behind the peak.
        subject.poll(rpc)
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 1_900.0
        )

    def test_stagnation_anchor_survives_reconnect(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        subject.poll(FakeRpc(best=300, finalized=299))
        clock.advance(1_000.0)
        # A fresh connection object stands in for a reconnect; the monitor, not
        # the connection, owns the stall clock.
        subject.poll(FakeRpc(best=310, finalized=299))
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 1_000.0
        )


class FailClosedTests(unittest.TestCase):
    def assert_relay_series_absent(self, store: MetricStore) -> None:
        for name in monitor.RELAY_FAMILIES:
            self.assertIsNone(
                store_value(store, name),
                f"{name} must be absent after a collection failure, not zero",
            )
            self.assertNotIn(
                f"\n{name} ",
                "\n" + store.render(),
                f"{name} must not be rendered after a collection failure",
            )

    def test_rpc_failure_clears_relay_series(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=120, finalized=118)
        self.assertTrue(subject.poll(rpc))
        self.assertIsNotNone(store_value(store, "bleavit_relay_best_block"))
        rpc.fail_on = "chain_getHeader"
        self.assertFalse(subject.poll(rpc))
        self.assert_relay_series_absent(store)
        self.assertEqual(store_value(store, "bleavit_relay_monitor_connected"), 0)
        self.assertEqual(store_value(store, "bleavit_relay_monitor_errors_total"), 1)

    def test_malformed_finalized_hash_fails_closed(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=120, finalized=118)
        subject.poll(rpc)
        rpc.finalized_hash = None
        self.assertFalse(subject.poll(rpc))
        self.assert_relay_series_absent(store)

    def test_finalized_above_best_is_rejected(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        self.assertFalse(subject.poll(FakeRpc(best=100, finalized=101)))
        self.assert_relay_series_absent(store)
        self.assertEqual(store_value(store, "bleavit_relay_monitor_errors_total"), 1)

    def test_degrade_is_reversible_on_recovery(self) -> None:
        clock = Clock()
        store, subject = new_monitor(clock)
        rpc = FakeRpc(best=120, finalized=118)
        subject.poll(rpc)
        rpc.fail_on = "chain_getFinalizedHead"
        subject.poll(rpc)
        self.assert_relay_series_absent(store)
        rpc.fail_on = None
        clock.advance(45.0)
        self.assertTrue(subject.poll(rpc))
        self.assertEqual(store_value(store, "bleavit_relay_best_block"), 120)
        # The stall clock kept running across the outage rather than restarting.
        self.assertEqual(
            store_value(store, "bleavit_relay_finality_stagnation_seconds"), 45.0
        )

    def test_module_level_degrade_clears_without_a_monitor(self) -> None:
        store = MetricStore(monitor.SERIES)
        store.set("bleavit_relay_best_block", 7)
        monitor.degrade(store, MonitoringError("transport closed"))
        self.assert_relay_series_absent(store)
        self.assertEqual(store_value(store, "bleavit_relay_monitor_connected"), 0)


class ArgumentTests(unittest.TestCase):
    def assert_rejected(self, argv: list[str]) -> None:
        # argparse writes usage to stderr before exiting; keep the suite quiet.
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            monitor.parse_args(argv)

    def test_relay_url_scheme_is_enforced(self) -> None:
        self.assert_rejected(["--relay-url", "http://relay.invalid"])

    def test_defaults(self) -> None:
        args = monitor.parse_args(["--relay-url", "wss://relay.invalid"])
        self.assertEqual(args.bind, monitor.DEFAULT_BIND)
        self.assertEqual(
            args.stagnation_window, monitor.DEFAULT_STAGNATION_WINDOW_SECONDS
        )
        self.assertFalse(args.once)

    def test_non_positive_values_are_rejected(self) -> None:
        for flag in ("--interval", "--stagnation-window"):
            with self.subTest(flag=flag):
                self.assert_rejected(["--relay-url", "wss://relay.invalid", flag, "0"])

    def test_malformed_bind_is_rejected(self) -> None:
        self.assert_rejected(
            ["--relay-url", "wss://relay.invalid", "--bind", "127.0.0.1"]
        )


class WindowBindingTests(unittest.TestCase):
    """The [VERIFY] window is single-valued across spec, rule, and exporter."""

    def test_doc_rule_and_exporter_agree(self) -> None:
        doc = DOC.read_text(encoding="utf-8")
        rows = [
            line for line in doc.splitlines() if line.startswith("| Relay finality |")
        ]
        self.assertEqual(len(rows), 1, "12 §6.3 must carry exactly one Relay finality row")
        doc_match = re.search(r"finalized stagnant > (\d+) s \[VERIFY\]", rows[0])
        self.assertIsNotNone(doc_match, rows[0])
        rules = RULES.read_text(encoding="utf-8")
        rule_match = re.search(
            r"bleavit_relay_finality_stagnation_seconds > (\d+)", rules
        )
        self.assertIsNotNone(rule_match, "the Relay finality rule must threshold the gauge")
        assert doc_match is not None and rule_match is not None
        self.assertEqual(int(doc_match.group(1)), int(rule_match.group(1)))
        self.assertEqual(
            float(doc_match.group(1)), monitor.DEFAULT_STAGNATION_WINDOW_SECONDS
        )

    def test_window_is_marked_verify_in_the_rule_comment(self) -> None:
        self.assertIn("[VERIFY]", RULES.read_text(encoding="utf-8"))

    def test_configured_window_is_exported(self) -> None:
        store = MetricStore(monitor.SERIES)
        monitor.RelayFinalityMonitor(store, window=42.0, clock=Clock())
        self.assertEqual(
            store_value(store, "bleavit_relay_monitor_stagnation_window_seconds"), 42.0
        )


if __name__ == "__main__":
    unittest.main()
