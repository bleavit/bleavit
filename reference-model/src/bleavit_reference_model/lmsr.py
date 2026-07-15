from __future__ import annotations
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext

WORK_PREC = 100
BASE_UNIT = Decimal("0.000001")  # 02 §8: USDC has 6 decimals.
DOMAIN_CLAMP = Decimal(48)  # 04 §4: |q_L-q_S|/b <= 48.
FEE_RATE = Decimal("0.003")  # 13 §1 mkt.fee: 30 bps.
LN2 = Decimal(
    "0.6931471805599453094172321214581765680755001343602552541206800094933936219696947156058633269964186875"
)


class PriceBoundExceeded(ValueError):
    pass


def _d(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def fmt(x: Decimal, digits: int = 30) -> str:
    with localcontext() as ctx:
        ctx.prec = max(WORK_PREC, digits + 8)
        return format(+x, f".{digits}f")


def raw_64x64_nearest(x: Decimal) -> int:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return int(
            (_d(x) * (1 << 64) + Decimal("0.5")).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )


def ceil_base(x: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(x).quantize(BASE_UNIT, rounding=ROUND_CEILING)


def floor_base(x: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(x).quantize(BASE_UNIT, rounding=ROUND_FLOOR)


def check_domain(b, q_l, q_s) -> None:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        if _d(b) <= 0:
            raise ValueError("b must be positive")
        if abs((_d(q_l) - _d(q_s)) / _d(b)) > DOMAIN_CLAMP:
            raise PriceBoundExceeded("|q_l-q_s|/b exceeds 48")


def cost(b, q_l, q_s) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        b = _d(b)
        q_l = _d(q_l)
        q_s = _d(q_s)
        check_domain(b, q_l, q_s)
        m = max(q_l, q_s)
        return m + b * (((q_l - m) / b).exp() + ((q_s - m) / b).exp()).ln()


def marginal_price_long(b, q_l, q_s) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        b = _d(b)
        q_l = _d(q_l)
        q_s = _d(q_s)
        check_domain(b, q_l, q_s)
        return Decimal(1) / (Decimal(1) + ((q_s - q_l) / b).exp())


def buy_delta_cost(b, q_l, q_s, side: str, amount) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        if side.lower() in ("long", "yes"):
            nq_l, nq_s = _d(q_l) + _d(amount), _d(q_s)
        else:
            nq_l, nq_s = _d(q_l), _d(q_s) + _d(amount)
        return cost(b, nq_l, nq_s) - cost(b, q_l, q_s)


def sell_delta_proceeds(b, q_l, q_s, side: str, amount) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        if side.lower() in ("long", "yes"):
            nq_l, nq_s = _d(q_l) - _d(amount), _d(q_s)
        else:
            nq_l, nq_s = _d(q_l), _d(q_s) - _d(amount)
        return cost(b, q_l, q_s) - cost(b, nq_l, nq_s)


def _logit(p) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        p = _d(p)
        if not Decimal(0) < p < Decimal(1):
            raise ValueError("probability must be in (0, 1)")
        return (p / (Decimal(1) - p)).ln()


def displacement_for_price_move(b, p_from, p_to) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(b) * (_logit(p_to) - _logit(p_from))


def displacement_cost(b, p_from, p_to) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        p_from = _d(p_from)
        p_to = _d(p_to)
        return _d(b) * (
            ((Decimal(1) - p_from) / (Decimal(1) - p_to)).ln()
        )


def binary_entropy(p) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        p = _d(p)
        if p in (Decimal(0), Decimal(1)):
            return Decimal(0)
        if not Decimal(0) < p < Decimal(1):
            raise ValueError("probability must be in [0, 1]")
        return -p * p.ln() - (Decimal(1) - p) * (Decimal(1) - p).ln()


def maker_divergence_loss(b, p) -> Decimal:
    """Realized LMSR divergence loss b·(ln 2-H(p)), 04 §12."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(b) * (LN2 - binary_entropy(p))


def worked_maker_example() -> dict:
    """04 §12 worked ACCEPT-book displacement from 0.50 to 0.56."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        b = Decimal("25000")
        p = Decimal("0.56")
        delta = displacement_for_price_move(b, Decimal("0.5"), p)
        revenue = displacement_cost(b, Decimal("0.5"), p)
        payout = delta * p
        return {
            "b": b,
            "p": p,
            "loss": maker_divergence_loss(b, p),
            "delta": delta,
            "displacement_revenue": revenue,
            "expected_payout": payout,
        }


def ref_exp2(x) -> Decimal:
    """Reference exp2 for the futarchy-fixed primitive corpus (04 §4/§5)."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return (_d(x) * LN2).exp()


def ref_log2(x) -> Decimal:
    """Reference log2 for the futarchy-fixed primitive corpus (04 §4/§5)."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(x).ln() / LN2


def ref_ln(x) -> Decimal:
    """Reference ln for the futarchy-fixed primitive corpus (04 §4/§5)."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(x).ln()


def vectors_v1_v6() -> dict:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        b = Decimal("10000")
        v1 = buy_delta_cost(b, 0, 0, "long", 1000)
        fee = FEE_RATE * v1
        p = marginal_price_long(b, 1000, 0)
        loss = b * LN2
        return {
            "V1": {
                "action": "buy_1000_long_cost",
                "value": fmt(v1),
                "raw_64x64_nearest": raw_64x64_nearest(v1),
            },
            "V2": {
                "action": "price_after_v1",
                "value": fmt(p),
                "raw_64x64_nearest": raw_64x64_nearest(p),
            },
            "V3": {
                "action": "displace_0_5_to_0_6",
                "delta": fmt(displacement_for_price_move(b, "0.5", "0.6")),
                "cost": fmt(displacement_cost(b, "0.5", "0.6")),
            },
            "V4": {
                "action": "worst_case_loss",
                "value": fmt(loss),
                "raw_64x64_nearest": raw_64x64_nearest(loss),
            },
            "V5": {
                "action": "round_trip_v1_then_sell_1000",
                "proceeds_before_fees": fmt(v1),
                "net_fees_only": fmt(-Decimal(2) * fee),
            },
            "V6": {
                "action": "domain_edge",
                "b": "10000",
                "q_long": "480000",
                "q_short": "0",
                "side": "long",
                "amount": "1",
                "error": "PriceBoundExceeded",
            },
        }
