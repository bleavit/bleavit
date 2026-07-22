#!/usr/bin/env python3
"""Bleavit relay-finality Prometheus exporter (12 section 6.3, Relay finality row).

This is a **separate process** from ``chain_alerts_exporter.py`` by design, not
by convenience.  That exporter's outer loop is driven by the *parachain*
finalized-head subscription and its reconnect/backoff path, and every series it
publishes is anchored on the head returned by ``chain_getFinalizedHead`` against
the parachain node.  Parachain finality is derived from relay finality, so
during a relay GRANDPA stall — relay best advancing, GRANDPA lagging, the
parachain still building on the unfinalized best — that anchor stops moving and
every parachain-derived series *freezes at its last value rather than alerting*.
Folding relay collection into that loop would couple the relay signal to the
very connection the stall degrades.  12 section 6.3 requires the finalized-head
lag to be "monitored independently of the keeper process" and this row's relay
RPC to be independently configured; both are only meaningful in an independent
process with its own endpoint, its own bind address, and its own failure domain.

The relay is **polled** rather than subscribed to for the same reason: a
finalized-head subscription is silent during exactly the event this exporter
exists to observe, so wall-clock progress has to come from the poll cadence
instead of from notifications that will never arrive.

Collection failures degrade fail-closed per 12 section 6.3 (and the reader
discipline of section 3.1): the relay series go **absent**, never to a
healthy-looking zero, so a stalled relay and a broken exporter are never
indistinguishable from a finalizing one.

Importing this module performs no network imports.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    MetricStore,
    MonitoringError,
    SeriesDefinition,
    WsRpc,
    header_number,
    parse_bind,
    serve_metrics,
)


LOG = logging.getLogger("bleavit-relay-finality")

# [VERIFY] — Ops MUST calibrate this window from observed healthy relay
# behaviour before production; it is deliberately not derived here because the
# distribution of normal GRANDPA lag on the target relay cannot be measured from
# this repository.  Default rationale: healthy relay finality lags best by
# seconds, so 1800 s sits orders of magnitude above normal lag (no healthy relay
# trips it) while remaining far inside the 8-hour relay-block dead-man horizon,
# leaving operators time to act before the on-chain protective trigger engages.
#
# The value is owned by 12 section 6.3 — a monitoring choice, not a doc-13
# parameter — and MUST equal the window stated in that document's Relay finality
# row and in the matching Prometheus rule.  The monitoring test suite asserts
# those three literals agree.
DEFAULT_STAGNATION_WINDOW_SECONDS = 1800.0

DEFAULT_BIND = "127.0.0.1:9620"
DEFAULT_INTERVAL_SECONDS = 6.0
MAX_BACKOFF_SECONDS = 60.0


def _series(name: str, kind: str, help_text: str, *labels: str) -> SeriesDefinition:
    return SeriesDefinition(name, kind, help_text, tuple(labels))


SERIES: dict[str, SeriesDefinition] = {
    item.name: item
    for item in (
        _series("bleavit_relay_best_block", "gauge", "Relay-chain best (unfinalized) block height."),
        _series("bleavit_relay_finalized_block", "gauge", "Relay-chain GRANDPA finalized block height."),
        _series("bleavit_relay_finality_stagnation_seconds", "gauge", "Seconds since the relay finalized height last increased."),
        _series("bleavit_relay_monitor_connected", "gauge", "Whether the monitor has a live relay connection."),
        _series("bleavit_relay_monitor_errors_total", "counter", "Relay transport, response, and decode failures."),
        _series("bleavit_relay_monitor_last_successful_poll_timestamp_seconds", "gauge", "Unix time of the latest complete relay poll."),
        _series("bleavit_relay_monitor_stagnation_window_seconds", "gauge", "Configured [VERIFY] stagnation window this monitor was started with."),
    )
}

# The three series the Relay finality alert evaluates. They are cleared as one
# family set so a partial read can never leave a stale height paired with a live
# stagnation clock (or the reverse).
RELAY_FAMILIES = (
    "bleavit_relay_best_block",
    "bleavit_relay_finalized_block",
    "bleavit_relay_finality_stagnation_seconds",
)

# Response-shape, decode, and JSON-RPC-level failures. Transport failures raise
# library-specific exceptions and are handled by run()'s reconnect path, which
# degrades through the same helper.
COLLECTION_ERRORS = (MonitoringError, ValueError)


def degrade(store: MetricStore, error: object) -> None:
    """Fail closed: drop the relay family so it reads absent, never zero."""
    for family in RELAY_FAMILIES:
        store.clear_family(family)
    store.set("bleavit_relay_monitor_connected", 0)
    store.inc("bleavit_relay_monitor_errors_total")
    LOG.error("relay finality poll rejected: %s", error)


class RelayFinalityMonitor:
    """Poll relay best/finalized heights and track finality stagnation.

    The stagnation anchor is deliberately owned by this object rather than by a
    connection, so a reconnect cannot reset the stall clock and hide the very
    condition the row exists to catch. The anchor follows the *highest* finalized
    height ever observed: a failover to a lagging RPC can then only over-report
    stagnation, never conceal it.
    """

    def __init__(
        self,
        store: MetricStore,
        *,
        window: float = DEFAULT_STAGNATION_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.store = store
        self.window = window
        self.clock = clock
        self.peak_finalized: int | None = None
        self.anchor: float | None = None
        self.warned = False
        store.set("bleavit_relay_monitor_stagnation_window_seconds", window)

    def stagnation_seconds(self, finalized: int) -> float:
        now = self.clock()
        if self.peak_finalized is None or finalized > self.peak_finalized:
            # First observation anchors the clock: a monitor started during an
            # ongoing stall therefore needs up to one window to fire. That is a
            # declared limitation of this row, not an oversight.
            self.peak_finalized = finalized
            self.anchor = now
            self.warned = False
            return 0.0
        if self.anchor is None:
            self.anchor = now
        return max(0.0, now - self.anchor)

    def _heights(self, rpc: WsRpc) -> tuple[int, int]:
        # chain_getHeader with no argument returns the best head.
        best = header_number(rpc.call("chain_getHeader"))
        finalized_hash = rpc.call("chain_getFinalizedHead")
        if not isinstance(finalized_hash, str):
            raise MonitoringError("chain_getFinalizedHead returned no relay hash")
        finalized = header_number(rpc.call("chain_getHeader", [finalized_hash]))
        if finalized > best:
            raise MonitoringError(
                f"relay finalized height {finalized} exceeds best height {best}"
            )
        return best, finalized

    def poll(self, rpc: WsRpc) -> bool:
        """One complete relay observation. Returns False after degrading."""
        try:
            best, finalized = self._heights(rpc)
        except COLLECTION_ERRORS as error:
            degrade(self.store, error)
            return False
        stagnation = self.stagnation_seconds(finalized)
        self.store.set("bleavit_relay_best_block", best)
        self.store.set("bleavit_relay_finalized_block", finalized)
        self.store.set("bleavit_relay_finality_stagnation_seconds", stagnation)
        self.store.set("bleavit_relay_monitor_connected", 1)
        self.store.set(
            "bleavit_relay_monitor_last_successful_poll_timestamp_seconds", time.time()
        )
        if stagnation > self.window and best > finalized:
            if not self.warned:
                LOG.warning(
                    "relay finality stagnant for %.0fs (window %.0fs): best %d, finalized %d",
                    stagnation,
                    self.window,
                    best,
                    finalized,
                )
                self.warned = True
        return True


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export relay-chain finality-progress series (12 §6.3 Relay finality)."
    )
    parser.add_argument(
        "--relay-url",
        required=True,
        help="relay-chain WebSocket endpoint (ws:// or wss://), configured independently of the parachain exporter",
    )
    parser.add_argument("--bind", default=DEFAULT_BIND, help="Prometheus listen HOST:PORT")
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_INTERVAL_SECONDS,
        help="relay poll cadence in seconds",
    )
    parser.add_argument(
        "--stagnation-window",
        type=float,
        default=DEFAULT_STAGNATION_WINDOW_SECONDS,
        help="[VERIFY] seconds of finality stagnation the alert treats as a stall; calibrate from observed healthy relay behaviour",
    )
    parser.add_argument("--once", action="store_true", help="poll once to stdout and exit")
    args = parser.parse_args(argv)
    if not args.relay_url.startswith(("ws://", "wss://")):
        parser.error("--relay-url must start with ws:// or wss://")
    if args.interval <= 0:
        parser.error("--interval must be positive")
    if args.stagnation_window <= 0:
        parser.error("--stagnation-window must be positive")
    try:
        parse_bind(args.bind)
    except MonitoringError as error:
        parser.error(str(error))
    return args


def run(args: argparse.Namespace) -> int:
    store = MetricStore(SERIES)
    store.set("bleavit_relay_monitor_connected", 0)
    monitor = RelayFinalityMonitor(store, window=args.stagnation_window)
    if not args.once:
        try:
            serve_metrics(store, args.bind)
        except (OSError, MonitoringError) as error:
            LOG.error("metrics bind failed: %s", error)
            return 2
    backoff = 1.0
    while True:
        rpc: WsRpc | None = None
        try:
            rpc = WsRpc(args.relay_url)
            if args.once:
                complete = monitor.poll(rpc)
                sys.stdout.write(store.render())
                return 0 if complete else 2
            while True:
                if monitor.poll(rpc):
                    backoff = 1.0
                time.sleep(args.interval)
        except KeyboardInterrupt:
            return 0
        except Exception as error:  # transport libraries expose several exception classes.
            degrade(store, error)
            LOG.error("relay connection failure: %s; reconnecting in %.0fs", error, backoff)
            if args.once:
                sys.stdout.write(store.render())
                return 2
            time.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
        finally:
            if rpc is not None:
                try:
                    rpc.close()
                except Exception:
                    pass


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
