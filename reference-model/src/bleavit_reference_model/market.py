"""Independent 04 §6 market-wrapper semantics.

This module models the custody transitions that sit around the LMSR math.  It
is derived from the architecture text, not from ``market-core``: the point is
to make fee routing and operation ordering independently executable.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, localcontext

from .lmsr import LN2, WORK_PREC, buy_delta_cost

USDC_SCALE = 1_000_000
BPS_DENOMINATOR = 10_000
MARKET_FEE_BPS = 30


class BaselineMarketError(ValueError):
    """A status-quo Baseline wrapper refusal."""


class InsufficientBookInventory(BaselineMarketError):
    """The book cannot deliver the bought leg after fee segregation."""


def _units(amount: int) -> Decimal:
    return Decimal(amount) / Decimal(USDC_SCALE)


def _base_units_up(amount: Decimal) -> int:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return int(
            (amount * Decimal(USDC_SCALE)).to_integral_value(
                rounding=ROUND_CEILING
            )
        )


def market_fee_up(cost: int, fee_bps: int = MARKET_FEE_BPS) -> int:
    """04 §4: market charges round up, on the integer USDC grid."""

    if cost < 0 or not 0 <= fee_bps <= BPS_DENOMINATOR:
        raise ValueError("invalid market fee inputs")
    numerator = cost * fee_bps
    return (numerator + BPS_DENOMINATOR - 1) // BPS_DENOMINATOR


@dataclass
class BaselineBook:
    """The 04 §6.1 Baseline buy wrapper and its buy-fee Sweep leg.

    All balances are USDC base-unit position quantities. ``book_*`` is LMSR
    inventory, ``fees_*`` is the per-market fee account, and ``buyer_*`` is the
    trader's position balance. The model intentionally keeps each owner
    separate: collapsing them is the SQ-519 defect.
    """

    epoch: int
    b: int
    book_long: int
    book_short: int
    q_long: int = 0
    q_short: int = 0
    fees_long: int = 0
    fees_short: int = 0
    buyer_long: int = 0
    buyer_short: int = 0
    main_usdc: int = 0
    settled: bool = False

    def __post_init__(self) -> None:
        values = (
            self.epoch,
            self.b,
            self.book_long,
            self.book_short,
            self.q_long,
            self.q_short,
            self.fees_long,
            self.fees_short,
            self.buyer_long,
            self.buyer_short,
            self.main_usdc,
        )
        if any(value < 0 for value in values) or self.b == 0:
            raise ValueError("Baseline book values must be non-negative")

    def quote_buy(
        self,
        side: str,
        amount: int,
        fee_bps: int = MARKET_FEE_BPS,
    ) -> tuple[int, int]:
        if side not in ("Long", "Short") or amount <= 0:
            raise ValueError("invalid Baseline buy")
        cost = _base_units_up(
            buy_delta_cost(
                _units(self.b),
                _units(self.q_long),
                _units(self.q_short),
                side,
                _units(amount),
            )
        )
        return cost, market_fee_up(cost, fee_bps)

    def buy(
        self,
        side: str,
        amount: int,
        fee_bps: int = MARKET_FEE_BPS,
    ) -> dict[str, int | str]:
        """Execute 04 §6.1's four ordered, atomic Baseline buy steps."""

        if self.settled:
            raise BaselineMarketError("Baseline book is terminal")
        cost, fee = self.quote_buy(side, amount, fee_bps)
        total = cost + fee

        # Work on a candidate post-image so every refusal is status-quo (G-1).
        buyer_long = self.buyer_long + total
        buyer_short = self.buyer_short + total
        book_long = self.book_long
        book_short = self.book_short
        fees_long = self.fees_long
        fees_short = self.fees_short

        # (b) Segregate fee revenue before the purchased leg can be paid.
        buyer_long -= fee
        buyer_short -= fee
        fees_long += fee
        fees_short += fee

        # (c) Only cost becomes book inventory.
        buyer_long -= cost
        buyer_short -= cost
        book_long += cost
        book_short += cost

        # (d) A book that is short after (b) genuinely cannot fund the trade.
        if side == "Long":
            if book_long < amount:
                raise InsufficientBookInventory(
                    "book cannot fund Long after fee segregation"
                )
            book_long -= amount
            buyer_long += amount
            q_long = self.q_long + amount
            q_short = self.q_short
        else:
            if book_short < amount:
                raise InsufficientBookInventory(
                    "book cannot fund Short after fee segregation"
                )
            book_short -= amount
            buyer_short += amount
            q_long = self.q_long
            q_short = self.q_short + amount

        self.book_long = book_long
        self.book_short = book_short
        self.fees_long = fees_long
        self.fees_short = fees_short
        self.buyer_long = buyer_long
        self.buyer_short = buyer_short
        self.q_long = q_long
        self.q_short = q_short
        return {
            "side": side,
            "amount": amount,
            "cost": cost,
            "fee": fee,
            "total_debit": total,
        }

    def settle(self) -> None:
        self.settled = True

    def sweep_buy_fees(self) -> int:
        """Redeem the minimum complete fee set to MAIN, uncharged."""

        if not self.settled:
            raise BaselineMarketError("Baseline vault is not terminal")
        complete_set = min(self.fees_long, self.fees_short)
        if complete_set == 0:
            return 0
        self.fees_long -= complete_set
        self.fees_short -= complete_set
        self.main_usdc += complete_set
        return complete_set

    def balances(self) -> dict[str, int]:
        return {
            "book_long": self.book_long,
            "book_short": self.book_short,
            "fees_long": self.fees_long,
            "fees_short": self.fees_short,
            "buyer_long": self.buyer_long,
            "buyer_short": self.buyer_short,
            "main_usdc": self.main_usdc,
        }


def baseline_market_scenarios() -> list[dict[str, object]]:
    """Deterministic SQ-519 vectors derived from 04 §6.1."""

    b = 10_000 * USDC_SCALE
    amount = 1_000 * USDC_SCALE
    seed_inventory = _base_units_up(_units(b) * LN2)

    funded = BaselineBook(
        epoch=7,
        b=b,
        book_long=seed_inventory,
        book_short=seed_inventory,
    )
    execution = funded.buy("Long", amount)
    after_buy = funded.balances()
    funded.settle()
    swept = funded.sweep_buy_fees()
    after_sweep = funded.balances()

    probe = BaselineBook(epoch=7, b=b, book_long=0, book_short=0)
    cost, fee = probe.quote_buy("Long", amount)
    thin_inventory = amount - cost - 1
    thin = BaselineBook(
        epoch=7,
        b=b,
        book_long=thin_inventory,
        book_short=thin_inventory,
    )
    before_failure = thin.balances()
    error = None
    try:
        thin.buy("Long", amount)
    except InsufficientBookInventory as caught:
        error = caught.__class__.__name__
    if error is None:
        raise AssertionError("underfunded Baseline vector unexpectedly traded")

    return [
        {
            "name": "baseline-buy-fee-complete-set-to-main",
            "inputs": {
                "epoch": 7,
                "b": b,
                "seed_inventory": seed_inventory,
                "side": "Long",
                "amount": amount,
                "fee_bps": MARKET_FEE_BPS,
            },
            "execution": execution,
            "after_buy": after_buy,
            "swept_to_main": swept,
            "after_sweep": after_sweep,
        },
        {
            "name": "baseline-buy-fee-segregation-refuses-thin-book",
            "inputs": {
                "epoch": 7,
                "b": b,
                "book_inventory": thin_inventory,
                "side": "Long",
                "amount": amount,
                "fee_bps": MARKET_FEE_BPS,
            },
            "quote": {"cost": cost, "fee": fee},
            "pooled_inventory": thin_inventory + cost + fee,
            "segregated_inventory": thin_inventory + cost,
            "expected_error": error,
            "before": before_failure,
            "after": thin.balances(),
        },
    ]
