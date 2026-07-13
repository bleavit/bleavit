from dataclasses import dataclass
from decimal import Decimal

@dataclass(frozen=True)
class Observation:
    block: int
    value: Decimal

class TwapAccumulator:
    def __init__(self, initial: Decimal, kappa: Decimal = Decimal("0.005")):
        self.last = initial; self.kappa = kappa; self.points = [Observation(0, initial)]
    def observe(self, block: int, previous_quote: Decimal) -> Decimal:
        if block <= self.points[-1].block: raise ValueError("block must increase")
        lo = self.last * (Decimal(1) - self.kappa); hi = self.last * (Decimal(1) + self.kappa)
        self.last = min(max(previous_quote, lo), hi)
        self.points.append(Observation(block, self.last)); return self.last
    def mean(self, start: int, end: int) -> Decimal:
        if end <= start: raise ValueError("bad window")
        total = Decimal(0); pts = self.points
        for a, b in zip(pts, pts[1:]):
            s = max(start, a.block); e = min(end, b.block)
            if e > s: total += a.value * (e - s)
        if end > pts[-1].block and pts[-1].block < end: total += pts[-1].value * (end - max(start, pts[-1].block))
        return total / Decimal(end - start)
