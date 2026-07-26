from __future__ import annotations
from decimal import Decimal, ROUND_FLOOR, localcontext
from typing import Iterable, Mapping, Sequence

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
# 05 §4.3 canonical S component ids (MetricIds 10, 11, 12). S is a `min`, so it
# carries no weights, but the 07 §10 recompute needs names to drop against.
S_COMPONENT_IDS = ("U", "F", "D_eff")
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


def _unsigned_q64_div(numerator: Decimal, denominator: Decimal) -> Decimal:
    """Mirror FixedU64x64::checked_div after 1e9-grid inputs enter Q64."""
    numerator_raw = int(
        (floor_fixed(numerator) * Q64_SCALE).to_integral_value(
            rounding=ROUND_FLOOR
        )
    )
    denominator_raw = int(
        (floor_fixed(denominator) * Q64_SCALE).to_integral_value(
            rounding=ROUND_FLOOR
        )
    )
    if numerator_raw < 0 or denominator_raw <= 0:
        raise ValueError(
            "unsigned Q64 division needs a non-negative numerator "
            "and positive denominator"
        )
    return Decimal((numerator_raw << 64) // denominator_raw) / Q64_SCALE


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
    """05 §4.4(2), including MetricId ordering and per-product 64.64 floor.

    Subject to §4.4's exactness rule for a **degenerate single-term group**
    (SQ-493): where exactly one term participates and its (possibly
    renormalized) weight is exactly 1, the group's value *is* that term's
    ε-floored value — every other term contributed a factor of exactly 1, and
    the `exp2(log2(x))` round-trip would floor one 1e-9 ulp short of an on-grid
    `x`. Renormalization is what makes a weight of exactly 1 reachable (07 §10
    drops one of two equally-weighted components), so this is not hypothetical.
    """
    if set(values) != set(weights):
        raise ValueError("values and weights must have identical MetricIds")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        total_weight = sum((floor_fixed(weights[key]) for key in weights), ZERO)
        if total_weight <= 0:
            raise ValueError("weight sum must be positive")
        terms = []
        for metric_id in sorted(values, key=lambda value: str(value)):
            value = floor_fixed(_clamp(_d(values[metric_id])))
            weight = floor_fixed(_d(weights[metric_id]))
            if renormalize:
                weight = _unsigned_q64_div(weight, total_weight)
            terms.append((value, weight))
        participating = [term for term in terms if term[1] > ZERO]
        if len(participating) == 1 and participating[0][1] == ONE:
            return floor_fixed(_clamp(max(participating[0][0], _d(epsilon))))
        exponent = ZERO
        for value, weight in terms:
            exponent += floor_64x64(weight * _log2(max(value, _d(epsilon))))
        return floor_fixed(_clamp(_exp2(exponent)))


def _dropped_ids(dropped: Iterable | None) -> frozenset:
    return frozenset() if dropped is None else frozenset(dropped)


def _kept(values: Mapping, dropped: frozenset) -> dict:
    return {key: value for key, value in values.items() if key not in dropped}


def _pillar_components(
    p_components: Mapping | None,
    a_components: Mapping | None,
) -> tuple[dict, dict]:
    """Single home for the P/A component defaults (`pillar_values` shape)."""
    return (
        {"P": ONE} if p_components is None else dict(p_components),
        {"A": ONE} if a_components is None else dict(a_components),
    )


def drop_and_renormalize(
    values: Mapping,
    weights: Mapping,
    dropped: Iterable | None = None,
    epsilon: Decimal = EPSILON_P,
) -> Decimal:
    """07 §10 recompute for one weighted pillar group.

    "Two consecutive flagged epochs ⇒ affected not-yet-settled cohorts recompute
    `W` without the component, weights renormalized" (07 §10). Renormalization is
    `w_j / Σ_surviving w` on the normative Q64.64 grid 05 §4.4 already specifies
    for the `C_daily` quotient (SQ-321): same quotient, same rule, applied to the
    surviving subset instead of the on-chain subset.

    A drop that would empty the group is **declined** — the group keeps every
    component. An empty weighted product evaluates to 1.0 (the empty-product
    identity), i.e. the most favourable value there is, so honoring such a drop
    would turn total unavailability of a pillar into a perfect pillar. The caller
    decides where that is safe: for the joint C vector and for S it never is
    (nothing renormalizes their absence away), so they go through this function
    and take the decline. For P/A the composite's own `{wP, wA}` renormalization
    handles an emptied pillar one level up (`emptied_pillar_groups`).
    """
    dropped = _dropped_ids(dropped)
    kept = _kept(values, dropped)
    if len(kept) == len(values) or not kept:
        return weighted_geometric(values, weights, epsilon)
    return weighted_geometric(
        kept, {key: weights[key] for key in kept}, epsilon, renormalize=True
    )


def emptied_pillar_groups(
    dropped: Iterable | None,
    p_components: Mapping | None = None,
    a_components: Mapping | None = None,
) -> frozenset:
    """Which GeoComposite pillars lose every component to a 07 §10 drop.

    A pillar with no surviving component has no weight left to renormalize
    *within* the pillar, so the renormalization moves up to 05 §4.1's
    `{wP, wA}`: the survivor carries weight exactly 1 and the composite becomes
    that pillar alone. When both pillars would empty there is no survivor to
    carry the weight, so the drop is declined for both (an empty composite would
    read as 1.0 — see `drop_and_renormalize`).
    """
    dropped = _dropped_ids(dropped)
    p_components, a_components = _pillar_components(p_components, a_components)
    emptied = frozenset(
        name
        for name, components in (("P", p_components), ("A", a_components))
        if components and not _kept(components, dropped)
    )
    return frozenset() if emptied == frozenset({"P", "A"}) else emptied


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
    dropped: Iterable | None = None,
    s_ids: Sequence[str] = S_COMPONENT_IDS,
) -> dict[str, Decimal]:
    """05 §4.4 pillar values; `dropped` applies the 07 §10 settlement recompute.

    `dropped` names the components a cohort must settle without (flagged in two
    consecutive epochs meeting inside its `W_{e+1}`/`W_{e+2}` window). Only
    attested components can ever be flagged (07 §11(1)(i)), but that provenance
    rule is the oracle's, not this function's: it accepts any component id so the
    on-chain-only decline paths of `drop_and_renormalize` stay exercisable.

    `S_daily`/`C_daily` are deliberately **not** recomputed. They are that day's
    counters, they settle the gate markets, and no attested value may ever move a
    gate flag (05 §4.7 / §4.2); 07 §10's recompute is a settlement-time `W`
    operation, and a failed *gate* input escalates to VOID instead.
    """
    c_attested = {} if c_attested is None else dict(c_attested)
    p_components, a_components = _pillar_components(p_components, a_components)
    p_weights = {"P": ONE} if p_weights is None else dict(p_weights)
    a_weights = {"A": ONE} if a_weights is None else dict(a_weights)
    joint_c = dict(c_onchain)
    joint_c.update(c_attested)
    if set(joint_c) != set(c_weights):
        raise ValueError("C values and weights must have identical MetricIds")
    if len(set(s_ids)) != 3:
        raise ValueError("S needs exactly three distinct component ids")
    dropped = _dropped_ids(dropped)
    unknown = sorted(
        dropped
        - set(joint_c)
        - set(p_components)
        - set(a_components)
        - set(s_ids)
    )
    if unknown:
        raise ValueError(f"dropped ids absent from the MetricSpec set: {unknown}")
    s_values = dict(zip(s_ids, (u, f, d_eff)))
    # S is unweighted, so an emptied S has nothing to renormalize away either:
    # `min()` over no component is +inf, and reporting the pillar as 1.0 would
    # read a wholly unmeasured chain as a perfectly live one. Decline the drop.
    kept_s = _kept(s_values, dropped) or s_values
    s = min(floor_fixed(value) for value in kept_s.values())
    c_geo = drop_and_renormalize(joint_c, c_weights, dropped, EPSILON_C)
    c = floor_fixed(floor_fixed(incident) * c_geo)
    emptied = emptied_pillar_groups(dropped, p_components, a_components)
    # An emptied P/A is the empty weighted product = 1 on the FixedU64 grid. It
    # is inert — the composite renormalizes its weight to exactly 0
    # (`emptied_pillar_groups`) — and MUST NOT be read as "this pillar is
    # perfect": where nothing renormalizes an absence away the drop is declined
    # instead (`drop_and_renormalize`).
    p = (
        floor_fixed(ONE)
        if "P" in emptied
        else drop_and_renormalize(p_components, p_weights, dropped, EPSILON_P)
    )
    a = (
        floor_fixed(ONE)
        if "A" in emptied
        else drop_and_renormalize(a_components, a_weights, dropped, EPSILON_P)
    )
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
    emptied_pillars: Iterable | None = None,
) -> Decimal:
    """05 §4.1 GeoComposite; `emptied_pillars` renormalizes `{wP, wA}` (07 §10).

    A pillar every one of whose components was dropped leaves the composite with
    one term: `{wP, wA}` renormalizes over the survivor, which with wP + wA = 1
    makes the composite that pillar alone at weight exactly 1. Naming both
    pillars is not a valid input — `emptied_pillar_groups` declines that case
    rather than composing an empty product.
    """
    values = {"P": floor_fixed(p), "A": floor_fixed(a)}
    weights = {"P": _d(weight_p), "A": _d(weight_a)}
    emptied = _dropped_ids(emptied_pillars)
    kept = _kept(values, emptied)
    if len(kept) == len(values) or not kept:
        return weighted_geometric(values, weights, EPSILON_P)
    return weighted_geometric(
        kept,
        {key: weights[key] for key in kept},
        EPSILON_P,
        renormalize=True,
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
    emptied_pillars: Iterable | None = None,
) -> Decimal:
    """05 §4.1/§4.4(3): g(S)·g(C)·GeoComposite with immediate floors."""
    gs = gate(s, theta_s_lo, theta_s_hi)
    gc = gate(c, theta_c_lo, theta_c_hi)
    pa = geo_composite(p, a, weight_p, weight_a, emptied_pillars)
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
    dropped: Iterable | None = None,
    s_ids: Sequence[str] = S_COMPONENT_IDS,
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
        dropped,
        s_ids,
    )
    pillars["D_eff"] = d_eff
    pillars["W"] = welfare_value(
        pillars["S"],
        pillars["C"],
        pillars["P"],
        pillars["A"],
        emptied_pillars=emptied_pillar_groups(
            dropped, p_components, a_components
        ),
    )
    return pillars


def full_pipeline_renormalized(
    *,
    dropped: Iterable,
    **inputs,
) -> dict[str, Decimal]:
    """07 §10 settlement-time recompute of one epoch's pillars and `W`.

    A cohort at epoch `e` settles from `W_{e+1}` and `W_{e+2}` (05 §4.4(4)). A
    component flagged in two consecutive epochs that meet inside that window —
    `(e, e+1)` or `(e+1, e+2)` — is dropped from **both** of the cohort's `W`
    recomputes, so this is called once per horizon epoch with the same drop set.
    Everything else is unchanged §4.4: same ε floors, same ascending-MetricId
    evaluation order, same immediate-floor rounding, `I` still a pure multiplier.
    """
    dropped = _dropped_ids(dropped)
    if not dropped:
        raise ValueError("the 07 §10 recompute needs at least one dropped id")
    return full_pipeline(dropped=dropped, **inputs)


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
