from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, localcontext

WORK_PREC = 100
STALE_GAP_BLOCKS = 50  # 04 §7.


@dataclass(frozen=True)
class Observation:
    block: int
    value: Decimal
    cumulative: Decimal


class TwapAccumulator:
    """Backward-weighted slew-capped accumulator from 04 §7."""

    def __init__(
        self,
        initial: Decimal,
        kappa: Decimal = Decimal("0.005"),
        obs_interval: int = 10,
    ):
        if obs_interval <= 0:
            raise ValueError("obs_interval must be positive")
        self.last = Decimal(initial)
        self.kappa = Decimal(kappa)
        self.obs_interval = obs_interval
        self.stale_events = 0
        self.points = [Observation(0, self.last, Decimal(0))]

    def observe(self, block: int, previous_quote: Decimal) -> Decimal:
        previous = self.points[-1]
        if block <= previous.block:
            raise ValueError("block must increase")
        elapsed = block - previous.block
        if elapsed > STALE_GAP_BLOCKS:
            self.stale_events += 1
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            k = max(1, elapsed // self.obs_interval)
            lo = self.last * (Decimal(1) - self.kappa) ** k
            hi = self.last * (Decimal(1) + self.kappa) ** k
            self.last = min(max(Decimal(previous_quote), lo), hi)
            cumulative = previous.cumulative + self.last * elapsed
            self.points.append(Observation(block, self.last, cumulative))
            return self.last

    def cumulative_at(self, block: int) -> Decimal:
        """A(block), where o_i weights the backward interval (t_{i-1}, t_i]."""
        if block < self.points[0].block or block > self.points[-1].block:
            raise ValueError("block is outside the recorded accumulator")
        if block == self.points[0].block:
            return self.points[0].cumulative
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            for left, right in zip(self.points, self.points[1:]):
                if block <= right.block:
                    return left.cumulative + right.value * (block - left.block)
        raise AssertionError("unreachable")

    def mean(self, start: int, end: int) -> Decimal:
        """TWAP = (A(end)-A(start))/(end-start), per 04 §7."""
        if end <= start:
            raise ValueError("bad window")
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            return (self.cumulative_at(end) - self.cumulative_at(start)) / Decimal(
                end - start
            )
