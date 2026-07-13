from __future__ import annotations
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, getcontext, localcontext
getcontext().prec = 90
BASE_UNIT = Decimal("0.000001")
DOMAIN_CLAMP = Decimal(48)
FEE_RATE = Decimal("0.003")
LN2 = Decimal(2).ln()

class PriceBoundExceeded(ValueError): pass

def _d(x) -> Decimal: return x if isinstance(x, Decimal) else Decimal(str(x))
def fmt(x: Decimal, digits: int = 30) -> str:
    with localcontext() as ctx:
        ctx.prec = digits + 8
        return format(+x, f".{digits}f")
def raw_64x64_nearest(x: Decimal) -> int: return int((x * (1 << 64) + Decimal("0.5")).to_integral_value(rounding=ROUND_FLOOR))
def ceil_base(x: Decimal) -> Decimal: return _d(x).quantize(BASE_UNIT, rounding=ROUND_CEILING)
def floor_base(x: Decimal) -> Decimal: return _d(x).quantize(BASE_UNIT, rounding=ROUND_FLOOR)
def check_domain(b, q_l, q_s) -> None:
    if abs((_d(q_l) - _d(q_s)) / _d(b)) > DOMAIN_CLAMP: raise PriceBoundExceeded("|q_l-q_s|/b exceeds 48")
def cost(b, q_l, q_s) -> Decimal:
    b=_d(b); q_l=_d(q_l); q_s=_d(q_s); check_domain(b,q_l,q_s); m=max(q_l,q_s)
    return m + b * (((q_l-m)/b).exp() + ((q_s-m)/b).exp()).ln()
def marginal_price_long(b, q_l, q_s) -> Decimal:
    b=_d(b); q_l=_d(q_l); q_s=_d(q_s); check_domain(b,q_l,q_s)
    return Decimal(1) / (Decimal(1) + ((q_s-q_l)/b).exp())
def buy_delta_cost(b, q_l, q_s, side: str, amount) -> Decimal:
    nq_l, nq_s = (_d(q_l)+_d(amount), _d(q_s)) if side.lower() in ("long","yes") else (_d(q_l), _d(q_s)+_d(amount))
    return cost(b,nq_l,nq_s)-cost(b,q_l,q_s)
def sell_delta_proceeds(b, q_l, q_s, side: str, amount) -> Decimal:
    nq_l, nq_s = (_d(q_l)-_d(amount), _d(q_s)) if side.lower() in ("long","yes") else (_d(q_l), _d(q_s)-_d(amount))
    return cost(b,q_l,q_s)-cost(b,nq_l,nq_s)
def _logit(p): p=_d(p); return (p/(1-p)).ln()
def displacement_for_price_move(b, p_from, p_to) -> Decimal: return _d(b)*(_logit(p_to)-_logit(p_from))
def displacement_cost(b, p_from, p_to) -> Decimal: return _d(b)*(((Decimal(1)-_d(p_from))/(Decimal(1)-_d(p_to))).ln())
def vectors_v1_v6() -> dict:
    b=Decimal("10000"); v1=buy_delta_cost(b,0,0,"long",1000); fee=FEE_RATE*v1; p=marginal_price_long(b,1000,0); loss=b*LN2
    return {"V1":{"action":"buy_1000_long_cost","value":fmt(v1),"raw_64x64_nearest":raw_64x64_nearest(v1)},"V2":{"action":"price_after_v1","value":fmt(p),"raw_64x64_nearest":raw_64x64_nearest(p)},"V3":{"action":"displace_0_5_to_0_6","delta":fmt(displacement_for_price_move(b,"0.5","0.6")),"cost":fmt(displacement_cost(b,"0.5","0.6"))},"V4":{"action":"worst_case_loss","value":fmt(loss),"raw_64x64_nearest":raw_64x64_nearest(loss)},"V5":{"action":"round_trip_v1_then_sell_1000","proceeds_before_fees":fmt(v1),"net_fees_only":fmt(-2*fee)},"V6":{"action":"domain_edge","error":"PriceBoundExceeded"}}
