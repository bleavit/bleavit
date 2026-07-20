from __future__ import annotations
from decimal import Decimal, ROUND_FLOOR, localcontext
from typing import Mapping, Sequence

WORK_PREC = 100
ONE = Decimal(1)
ZERO = Decimal(0)
FIXED_GRID = Decimal("1e-9")
Q64_SCALE = Decimal(1 << 64)
EPSILON_C = Decimal("0.01")
EPSILON_P = Decimal("0.01")
EPSILON_W = Decimal("1e-9")
THETA_S_LO = Decimal("0.90")  # 13 §1 welfare.thetaS.
THETA_S_HI = Decimal("0.98")  # 13 §1 welfare.thetaS.
THETA_C_LO = Decimal("0.85")  # 13 §1 welfare.thetaC.
THETA_C_HI = Decimal("0.95")  # 13 §1 welfare.thetaC.
WEIGHT_P = Decimal("0.60")  # 13 §1 welfare.wP/wA.
WEIGHT_A = Decimal("0.40")  # 13 §1 welfare.wP/wA.
LN2 = Decimal(
    "0.6931471805599453094172321214581765680755001343602552541206800094933936219696947156058633269964186875"
)


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _clamp(value: Decimal, lo: Decimal = ZERO, hi: Decimal = ONE) -> Decimal:
    return min(max(value, lo), hi)


def floor_fixed(value) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _d(value).quantize(FIXED_GRID, rounding=ROUND_FLOOR)


def floor_64x64(value) -> Decimal:
    """Round toward negative infinity on the signed 64.64 grid."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        raw = (_d(value) * Q64_SCALE).to_integral_value(rounding=ROUND_FLOOR)
        return raw / Q64_SCALE


def _log2(value: Decimal) -> Decimal:
    if value <= 0:
        raise ValueError("log2 domain")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return value.ln() / LN2


def _exp2(value: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return (value * LN2).exp()


def weighted_geometric(
    values: Mapping,
    weights: Mapping,
    epsilon: Decimal = EPSILON_P,
    renormalize: bool = False,
) -> Decimal:
    """05 §4.4(2), including MetricId ordering and per-product 64.64 floor."""
    if set(values) != set(weights):
        raise ValueError("values and weights must have identical MetricIds")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        total_weight = sum((_d(weights[key]) for key in weights), ZERO)
        if total_weight <= 0:
            raise ValueError("weight sum must be positive")
        exponent = ZERO
        for metric_id in sorted(values, key=lambda value: str(value)):
            value = floor_fixed(_clamp(_d(values[metric_id])))
            weight = floor_fixed(_d(weights[metric_id]))
            if renormalize:
                weight = weight / total_weight
            term = floor_64x64(weight * _log2(max(value, _d(epsilon))))
            exponent += term
        return floor_fixed(_clamp(_exp2(exponent)))


def geometric_mean(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise ValueError("values must not be empty")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        exponent = sum((_log2(max(_d(value), EPSILON_W)) for value in values), ZERO)
        return floor_fixed(_exp2(exponent / Decimal(len(values))))


def gate(
    x,
    lo: Decimal = THETA_S_LO,
    hi: Decimal = THETA_S_HI,
) -> Decimal:
    """05 §4.4(3): every smoothstep multiplication floors to FixedU64."""
    x = floor_fixed(_d(x))
    lo = floor_fixed(_d(lo))
    hi = floor_fixed(_d(hi))
    if hi <= lo:
        raise ValueError("bad gate range")
    if x < lo:
        return ZERO
    if x >= hi:
        return ONE
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        t = floor_fixed((x - lo) / (hi - lo))
        t2 = floor_fixed(t * t)
        two_t = floor_fixed(Decimal(2) * t)
        return floor_fixed(t2 * (Decimal(3) - two_t))


def collator_n_cap(phase: int) -> int:
    if phase < 0:
        raise ValueError("phase must be non-negative")
    if phase <= 3:
        return 5
    if phase == 4:
        return 6
    if phase == 5:
        return 7
    return 8


def collator_d_eff(hhi, phase: int) -> Decimal:
    """05 §4.5 phase-capped collator concentration component."""
    hhi = _d(hhi)
    if not ZERO <= hhi <= ONE:
        raise ValueError("HHI must be in [0, 1]")
    n_cap = Decimal(collator_n_cap(phase))
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return floor_fixed(min(ONE, (ONE - hhi) / (ONE - ONE / n_cap)))


def pillar_values(
    u,
    f,
    d_eff,
    c_onchain: Mapping,
    c_weights: Mapping,
    incident=ONE,
    c_attested: Mapping | None = None,
    p_components: Mapping | None = None,
    p_weights: Mapping | None = None,
    a_components: Mapping | None = None,
    a_weights: Mapping | None = None,
    c_daily: Mapping | None = None,
) -> dict[str, Decimal]:
    c_attested = {} if c_attested is None else dict(c_attested)
    p_components = {"P": ONE} if p_components is None else dict(p_components)
    p_weights = {"P": ONE} if p_weights is None else dict(p_weights)
    a_components = {"A": ONE} if a_components is None else dict(a_components)
    a_weights = {"A": ONE} if a_weights is None else dict(a_weights)
    joint_c = dict(c_onchain)
    joint_c.update(c_attested)
    if set(joint_c) != set(c_weights):
        raise ValueError("C values and weights must have identical MetricIds")
    s = min(floor_fixed(u), floor_fixed(f), floor_fixed(d_eff))
    c_geo = weighted_geometric(joint_c, c_weights, EPSILON_C)
    c = floor_fixed(floor_fixed(incident) * c_geo)
    p = weighted_geometric(p_components, p_weights, EPSILON_P)
    a = weighted_geometric(a_components, a_weights, EPSILON_P)
    daily_values = dict(c_onchain) if c_daily is None else dict(c_daily)
    daily_weights = {key: c_weights[key] for key in c_onchain}
    daily_c = weighted_geometric(
        daily_values, daily_weights, EPSILON_C, renormalize=True
    )
    return {
        "S": s,
        "C": c,
        "P": p,
        "A": a,
        "S_daily": s,
        "C_daily": daily_c,
    }


def geo_composite(
    p,
    a,
    weight_p: Decimal = WEIGHT_P,
    weight_a: Decimal = WEIGHT_A,
) -> Decimal:
    return weighted_geometric(
        {"P": floor_fixed(p), "A": floor_fixed(a)},
        {"P": _d(weight_p), "A": _d(weight_a)},
        EPSILON_P,
    )


def welfare_value(
    s,
    c,
    p,
    a,
    theta_s_lo: Decimal = THETA_S_LO,
    theta_s_hi: Decimal = THETA_S_HI,
    theta_c_lo: Decimal = THETA_C_LO,
    theta_c_hi: Decimal = THETA_C_HI,
    weight_p: Decimal = WEIGHT_P,
    weight_a: Decimal = WEIGHT_A,
) -> Decimal:
    """05 §4.1/§4.4(3): g(S)·g(C)·GeoComposite with immediate floors."""
    gs = gate(s, theta_s_lo, theta_s_hi)
    gc = gate(c, theta_c_lo, theta_c_hi)
    pa = geo_composite(p, a, weight_p, weight_a)
    return floor_fixed(_clamp(floor_fixed(floor_fixed(gs * gc) * pa)))


def settlement_score(w_next, w_next_2) -> Decimal:
    """05 §4.4(4): exp2((log2 max(W1, eps_W) + log2 max(W2, eps_W)) / 2),
    i.e. the exact geometric mean sqrt(W1 * W2), floored to FixedU64.

    Evaluated as a correctly-rounded square root rather than a log2/exp2
    round-trip: the round-trip's residual error (at any finite precision)
    floors one grid ulp short whenever the true mean lies exactly ON the
    1e9 grid — including the eps_W corner, where a doubly-zeroed pair's
    exact score is exactly eps_W = 1e-9 (one base unit), not 0. 15 §4.4
    requires the exact floor, bit-identical across implementations.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        a = max(floor_fixed(w_next), EPSILON_W)
        b = max(floor_fixed(w_next_2), EPSILON_W)
        return floor_fixed(_clamp((a * b).sqrt()))


def full_pipeline(
    *,
    u,
    f,
    hhi,
    phase: int,
    c_onchain: Mapping,
    c_weights: Mapping,
    incident=ONE,
    c_attested: Mapping | None = None,
    p_components: Mapping | None = None,
    p_weights: Mapping | None = None,
    a_components: Mapping | None = None,
    a_weights: Mapping | None = None,
    c_daily: Mapping | None = None,
) -> dict[str, Decimal]:
    d_eff = collator_d_eff(hhi, phase)
    pillars = pillar_values(
        u,
        f,
        d_eff,
        c_onchain,
        c_weights,
        incident,
        c_attested,
        p_components,
        p_weights,
        a_components,
        a_weights,
        c_daily,
    )
    pillars["D_eff"] = d_eff
    pillars["W"] = welfare_value(
        pillars["S"], pillars["C"], pillars["P"], pillars["A"]
    )
    return pillars


def percentile(values: Sequence[Decimal], fraction: Decimal) -> Decimal:
    """Inclusive linear percentile used for the 12-point p5/p95 bounds."""
    if not values:
        raise ValueError("values must not be empty")
    fraction = _d(fraction)
    if not ZERO <= fraction <= ONE:
        raise ValueError("percentile must be in [0, 1]")
    ordered = sorted(_d(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        # Inclusive linear ("type-7") interpolation: rank 1 + f·(n−1) on the
        # ascending sample (05 §4.6). The interpolation is evaluated on the
        # FixedU64 1e9 grid and the product is rounded DOWN per §4.6/§4.4, so this
        # is a grid-exact conforming implementation (15 §4.4), never vacuous on the
        # 12-element sample.
        rank = Decimal(len(ordered) - 1) * fraction
        lower = int(rank.to_integral_value(rounding=ROUND_FLOOR))
        upper = min(lower + 1, len(ordered) - 1)
        part = rank - lower
        return floor_fixed(ordered[lower] + (ordered[upper] - ordered[lower]) * part)


def normalization_sample(
    prior_bounds: Sequence[Decimal],
    finalized_values: Sequence[Decimal],
) -> list[Decimal]:
    if len(prior_bounds) != 12:
        raise ValueError("PriorBounds must contain exactly 12 values")
    return [
        _d(value)
        for value in (list(prior_bounds) + list(finalized_values))[-12:]
    ]


def winsorize(values, lo, hi):
    lo = _d(lo)
    hi = _d(hi)
    return [min(max(_d(value), lo), hi) for value in values]


def minmax_normalize(value, lo, hi) -> Decimal:
    value = _d(value)
    lo = _d(lo)
    hi = _d(hi)
    if hi <= lo:
        raise ValueError("bad range")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return floor_fixed(_clamp((value - lo) / (hi - lo)))


def normalize_metric(
    value,
    prior_bounds: Sequence[Decimal],
    finalized_values: Sequence[Decimal],
    log1p: bool = False,
) -> Decimal:
    """05 §4.6 trailing-12 winsorization, optional log1p, and min-max."""
    sample = normalization_sample(prior_bounds, finalized_values)
    lo = percentile(sample, Decimal("0.05"))
    hi = percentile(sample, Decimal("0.95"))
    clipped = min(max(_d(value), lo), hi)
    if log1p:
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            clipped = (ONE + clipped).ln()
            lo = (ONE + lo).ln()
            hi = (ONE + hi).ln()
    return minmax_normalize(clipped, lo, hi)
