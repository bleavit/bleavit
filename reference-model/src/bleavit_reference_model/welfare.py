from decimal import Decimal, getcontext
getcontext().prec = 80

def geometric_mean(values):
    prod = Decimal(1)
    for v in values: prod *= Decimal(v)
    return prod ** (Decimal(1) / Decimal(len(values)))

def winsorize(values, lo, hi): return [min(max(Decimal(v), Decimal(lo)), Decimal(hi)) for v in values]
def minmax_normalize(value, lo, hi):
    lo=Decimal(lo); hi=Decimal(hi); value=Decimal(value)
    if hi <= lo: raise ValueError("bad range")
    return min(max((value-lo)/(hi-lo), Decimal(0)), Decimal(1))
def settlement_score(accept_welfare, reject_welfare):
    a=Decimal(accept_welfare); r=Decimal(reject_welfare)
    if a + r == 0: return Decimal("0.5")
    return a / (a + r)
