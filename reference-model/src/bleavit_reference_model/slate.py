"""08 §3, §4.1–§4.4, §5.3–§5.4, §7 — POL budgets and slate intake.

Doc 08 claims that Ask-scaled ``pol.b`` is the normative seeding rule, that a
``pol.budget_epoch`` budget shrinks a qualified slate to fit in bond-priority
order, and that the §7 bond schedule makes every monopolization path cost five
figures per epoch.  Composed with 05 §2.1's one-rollover transition table, those
claims imply that the budget must fund the books it prescribes and that a
budget drop delays an honest proposal once, then terminally cancels it.

Executing the arithmetic exposes SQ-543:

* at the shipped 0.75 % budget a CODE upgrade is unfundable at every NAV, with
  commitment/budget tending to 1.6233485828; META tends to 1.3808096786;
  a maximum lawful TREASURY ask has the CODE slope, so this is not specific to
  upgrades.  The 1.5 % kernel ceiling can fund CODE, above 7,361,153.04 USDC;
* the §4.4 rule is a greedy bond-priority prefix, not a maximum-cardinality
  packing.  Above every §4.1 class floor, adding one META to four PARAMs cuts
  the funded count from four to one even though four proposals still fit;
* the cheapest full blank at 25M NAV is five earlier-PID PARAM entries costing
  500 USDC/epoch, not the audit brief's one-META 5,000-USDC route.  The META
  route does reproduce 5,000 at 25M and requires Phase 6, but it is not the
  minimum.  Two blanked epochs take honest proposals through T6 then T26;
* 08 §7 publishes 18,900 USDC/epoch for combined monopolization while 14 TH-16
  publishes 10,900 for the same schedule; and §5.4's claim that
  ``b_floor*ln(2)/P_ref`` is class-invariant is false for META.

PARAM has no upgrade-payload NAV floor in 08 §5.2: its prize is its certified
capability envelope.  Therefore the brief's requested four-class universal
upgrade sweep is not a lawful composition; PARAM is fundable from 5M NAV on
the requested grid.  This module records that result instead of manufacturing
an upgrade interpretation for PARAM.

Units are whole USDC represented by 100-digit :class:`~decimal.Decimal`; NAV,
commitments, budgets, asks and bonds never use binary float.  Formula results
remain exact Decimal values.  A reported funding threshold rounds **up** to the
six-decimal USDC grid, against the proposal claimant.  Bond forfeits are exact;
dropped proposals cost no slash because 05 §2.1 T6/T26 refund them, while every
funded junk proposal is conservatively charged the full 08 §7 non-decision-
grade slash.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from decimal import Decimal, ROUND_CEILING, localcontext
from itertools import combinations_with_replacement
from pathlib import Path
from typing import Iterable, Literal, Sequence

from .lifecycle import BY_TAG, Config, fire
from .sustainability import (
    INTAKE_SLASH_FRACTION,
    PROP_BOND,
)
from .spec_values import (
    NAV_FLOOR_CODE,
    NAV_FLOOR_META,
    NAV_FLOOR_PARAM,
    NAV_FLOOR_TREASURY,
    NAV_FLOORS_USDC,
)
from .treasury import (
    BASE_UNIT,
    B_FLOORS,
    GATE_B,
    LN2,
    attack_cost_hat,
    dec_v_min,
    in_cap_prize,
    l_hat,
    p_ref,
    pol_b,
    security_sizing_ok,
)

WORK_PREC = 100
PERBILL_DENOMINATOR = Decimal(1_000_000_000)

ProposalClass = Literal["param", "treasury", "code", "meta"]
CLASS_ORDER: tuple[ProposalClass, ...] = ("param", "treasury", "code", "meta")

# ---------------------------------------------------------------------------
# 13 §1 registry values and 05 §2.1 bounded intake constants.
# ---------------------------------------------------------------------------

# 13 §1 `pol.budget_epoch`: 0.75 % default, no published lower bound, 1.5 % K max.
POL_BUDGET_DEFAULT = Decimal("0.0075")
POL_BUDGET_MIN = Decimal(0)
POL_BUDGET_MAX = Decimal("0.015")

# 13 §1 `trs.cap_proposal`: 5 % default, 10 % K ceiling.
CAP_PROPOSAL_DEFAULT = Decimal("0.05")
CAP_PROPOSAL_MAX = Decimal("0.10")

# 13 §1 `epoch.slots`, `intake.max_acct`, and `intake.slash_pct`.
EPOCH_SLOTS_DEFAULT = 5
INTAKE_MAX_ACCT_DEFAULT = 4
INTAKE_SLASH_DEFAULT = INTAKE_SLASH_FRACTION

# 05 §2.1 T1's kernel-bounded queue size.
INTAKE_QUEUE = 64

# 13 §1 `sec.prize.*` capability-envelope defaults. TREASURY uses its ask.
SEC_PRIZE_DEFAULT: dict[ProposalClass, Decimal] = {
    "param": Decimal(50_000),
    "treasury": Decimal(0),
    "code": Decimal(300_000),
    "meta": Decimal(600_000),
}

# 13 §1 `sec.flow_cap`: adopted 16, lawful [7 K, 32]. 08 §5.4 deliberately
# computes at 7, the unsafe-upward row's conservative lawful minimum.
SEC_FLOW_CAP_DEFAULT = Decimal(16)
SEC_FLOW_CAP_MIN = Decimal(7)
SEC_FLOW_CAP_MAX = Decimal(32)

# 13 §1 `prop.bond`'s TREASURY kernel surcharge: 50 bps = 0.5 % of Ask.
TREASURY_BOND_ASK_FRACTION = Decimal("0.005")

# 08 §4.1 frozen literals, shared by every consumer of those exact rows.
NAV_FLOORS = NAV_FLOORS_USDC

# 09's rollout schedule as consumed by 08 §4.2: PARAM Phase 4, TREASURY Phase 5,
# and the shared CODE/META bit at Phase 6.
CLASS_ARMING_PHASE: dict[ProposalClass, int] = {
    "param": 4,
    "treasury": 5,
    "code": 6,
    "meta": 6,
}


class SlateError(ValueError):
    """A malformed or unpriceable slate refuses rather than reading as funded."""


def _class_name(value: object) -> ProposalClass:
    name = str(getattr(value, "value", value)).lower()
    if name not in CLASS_ORDER:
        raise SlateError(f"unknown proposal class {value!r}")
    return name  # type: ignore[return-value]


def _d(value: Decimal | int | str) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _round_threshold_up(value: Decimal) -> Decimal:
    """Round a claimant's minimum NAV upward to the USDC base-unit grid."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return value.quantize(BASE_UNIT, rounding=ROUND_CEILING)


@dataclass(frozen=True)
class SlateParams:
    """The live 13 §1 values that move budget, capacity and attack cost."""

    pol_budget_epoch: Decimal = POL_BUDGET_DEFAULT
    cap_proposal: Decimal = CAP_PROPOSAL_DEFAULT
    gate_b: Decimal = GATE_B
    epoch_slots: int = EPOCH_SLOTS_DEFAULT
    intake_max_acct: int = INTAKE_MAX_ACCT_DEFAULT
    intake_slash_fraction: Decimal = INTAKE_SLASH_DEFAULT

    def validate(self) -> None:
        if not POL_BUDGET_MIN <= self.pol_budget_epoch <= POL_BUDGET_MAX:
            raise SlateError("pol.budget_epoch outside 13 §1's [0, 1.5%] range")
        if not Decimal(0) <= self.cap_proposal <= CAP_PROPOSAL_MAX:
            raise SlateError("trs.cap_proposal outside 13 §1's [0, 10%] range")
        if self.gate_b < 0:
            raise SlateError("negative pol.b_gate")
        if self.epoch_slots <= 0:
            raise SlateError("epoch.slots must be positive")
        if self.intake_max_acct <= 0:
            raise SlateError("intake.max_acct must be positive")
        if not Decimal(0) <= self.intake_slash_fraction <= Decimal(1):
            raise SlateError("intake.slash_pct outside [0, 100%]")


DEFAULTS = SlateParams()


# ---------------------------------------------------------------------------
# 08 §3 / §5.3 — exact commitments and their budget frontier.
# ---------------------------------------------------------------------------


def epoch_budget(nav: Decimal, params: SlateParams = DEFAULTS) -> Decimal:
    """08 §3/§4.4: ``pol.budget_epoch * spendable NAV``."""
    params.validate()
    nav = _d(nav)
    if nav < 0:
        raise SlateError("negative spendable NAV")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(params.pol_budget_epoch * nav)


def nav_floor_met(
    proposal_class: ProposalClass | str,
    spendable_nav: Decimal,
) -> bool:
    """08 §4.2's fail-static arming predicate over the frozen §4.1 literal."""
    name = _class_name(proposal_class)
    spendable_nav = _d(spendable_nav)
    if spendable_nav < 0:
        raise SlateError("negative spendable NAV")
    return spendable_nav >= NAV_FLOORS[name]


def floor_commitment(
    proposal_class: ProposalClass | str,
    params: SlateParams = DEFAULTS,
) -> Decimal:
    """08 §3: ``(2*b_floor(class) + 4*pol.b_gate) * ln(2)``."""
    params.validate()
    name = _class_name(proposal_class)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(Decimal(2) * B_FLOORS[name] + Decimal(4) * params.gate_b) * LN2


def proposal_prize(
    proposal_class: ProposalClass | str,
    nav: Decimal,
    *,
    ask: Decimal | None = None,
    envelope: Decimal | None = None,
    upgrade_payload: bool = True,
    params: SlateParams = DEFAULTS,
) -> Decimal:
    """08 §5.2's InCapPrize at the capacity edge used by this module.

    A missing TREASURY ``ask`` means its maximum admitted ask,
    ``trs.cap_proposal*nav``.  PARAM/CODE/META use their 13 §1 capability
    envelopes; only CODE/META interpret ``upgrade_payload`` and acquire the NAV
    floor.  This distinction is why PARAM is not part of the universal wedge.
    """
    params.validate()
    name = _class_name(proposal_class)
    nav = _d(nav)
    if nav < 0:
        raise SlateError("negative spendable NAV")
    if ask is None:
        ask = params.cap_proposal * nav if name == "treasury" else Decimal(0)
    if envelope is None and name != "treasury":
        envelope = SEC_PRIZE_DEFAULT[name]
    prize = in_cap_prize(
        name,
        ask=ask,
        envelope=envelope,
        spendable_nav=nav,
        cap_proposal=params.cap_proposal,
        upgrade_payload=upgrade_payload,
    )
    if prize is None:
        raise SlateError(f"undefined InCapPrize for {name}")
    return prize


def scaled_commitment(
    proposal_class: ProposalClass | str,
    nav: Decimal,
    *,
    ask: Decimal | None = None,
    envelope: Decimal | None = None,
    upgrade_payload: bool = True,
    params: SlateParams = DEFAULTS,
) -> Decimal:
    """Compose §5.3's Ask-scaled ``pol.b`` with §3's six-book commitment."""
    name = _class_name(proposal_class)
    prize = proposal_prize(
        name,
        nav,
        ask=ask,
        envelope=envelope,
        upgrade_payload=upgrade_payload,
        params=params,
    )
    b = pol_b(name, prize)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(Decimal(2) * b + Decimal(4) * params.gate_b) * LN2


def commitment_ratio(
    proposal_class: ProposalClass | str,
    nav: Decimal,
    *,
    params: SlateParams = DEFAULTS,
    **kwargs: Decimal | bool | None,
) -> Decimal:
    """Scaled commitment divided by the epoch budget; refuses a zero budget."""
    budget = epoch_budget(nav, params)
    if budget == 0:
        raise SlateError("commitment/budget ratio undefined at zero budget")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(scaled_commitment(proposal_class, nav, params=params, **kwargs) / budget)


def asymptotic_commitment_slope(
    proposal_class: ProposalClass | str,
    params: SlateParams = DEFAULTS,
) -> Decimal:
    """Commitment/NAV as NAV grows on §5.2's capacity-edge prize.

    TREASURY's missing ask is the maximum lawful ask; CODE/META carry an
    upgrade payload.  PARAM's capability envelope is constant, so its slope is
    zero rather than an invented ``trs.cap_proposal`` exposure.
    """
    params.validate()
    name = _class_name(proposal_class)
    if name == "param":
        return Decimal(0)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(
            Decimal(2)
            * B_FLOORS[name]
            * params.cap_proposal
            * LN2
            / p_ref(name)
        )


def asymptotic_budget_ratio(
    proposal_class: ProposalClass | str,
    params: SlateParams = DEFAULTS,
) -> Decimal:
    """The limiting commitment/budget ratio; zero budget refuses."""
    if params.pol_budget_epoch == 0:
        raise SlateError("asymptotic ratio undefined at zero budget")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(asymptotic_commitment_slope(proposal_class, params) / params.pol_budget_epoch)


@dataclass(frozen=True)
class FundingFrontier:
    """The first discrete Perbill rate above a linear commitment slope."""

    proposal_class: ProposalClass
    minimum_budget_ppb: int
    minimum_budget_fraction: Decimal
    nav_threshold: Decimal
    kernel_ceiling_nav_threshold: Decimal
    asymptotic_slope: Decimal


def _scaled_region_start(name: ProposalClass, params: SlateParams) -> Decimal:
    """NAV above which ``P=cap*NAV`` and ``P>P_ref`` both hold."""
    if name == "param":
        raise SlateError("PARAM has no NAV-scaled upgrade prize")
    envelope = SEC_PRIZE_DEFAULT[name]
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(max(envelope, p_ref(name)) / params.cap_proposal)


def funding_nav_threshold(
    proposal_class: ProposalClass | str,
    budget_fraction: Decimal,
    params: SlateParams = DEFAULTS,
) -> Decimal | None:
    """First NAV at which a capacity-edge scaled commitment fits.

    ``None`` means the budget slope is no larger than the commitment slope, so
    the fixed four-gate term prevents funding at every finite NAV.  Thresholds
    are rounded up against the proposal claimant to six decimals.
    """
    params.validate()
    name = _class_name(proposal_class)
    budget_fraction = _d(budget_fraction)
    if not POL_BUDGET_MIN <= budget_fraction <= POL_BUDGET_MAX:
        raise SlateError("budget fraction outside pol.budget_epoch's lawful range")
    if name == "param":
        if budget_fraction <= 0:
            return None
        return _round_threshold_up(floor_commitment(name, params) / budget_fraction)
    slope = asymptotic_commitment_slope(name, params)
    if budget_fraction <= slope:
        return None
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        # Before P crosses P_ref, §5.3 holds b at its floor even if the CODE/
        # META envelope has already yielded to cap*NAV. META at the 1.5 %
        # ceiling is funded in this constant region; CODE is not.
        constant_threshold = floor_commitment(name, params) / budget_fraction
        scaled_start = _scaled_region_start(name, params)
        if constant_threshold <= scaled_start:
            return _round_threshold_up(constant_threshold)

        # Above P_ref the commitment is linear in the claimant-adverse rounded
        # prize. On the six-decimal NAV grid, cap=5% maps each block of 20 NAV
        # micro-units to one prize micro-unit. Solve that integer staircase
        # exactly: first find the prize bucket whose *last* NAV point fits,
        # then the first fitting NAV point inside that bucket. This avoids a
        # falsely permissive continuous threshold and is exact at the default.
        inverse_cap = Decimal(1) / params.cap_proposal
        bucket = inverse_cap.to_integral_value()
        if bucket != inverse_cap:
            raise SlateError(
                "funding frontier requires a cap whose reciprocal is integral "
                "on the six-decimal grid"
            )
        bucket_size = int(bucket)
        prize_coefficient = Decimal(2) * B_FLOORS[name] * LN2 / p_ref(name)
        gate_term = Decimal(4) * params.gate_b * LN2
        per_bucket_margin = (
            budget_fraction * Decimal(bucket_size) - prize_coefficient
        ) * BASE_UNIT
        if per_bucket_margin <= 0:
            return None
        prize_bucket = int(
            (gate_term / per_bucket_margin).to_integral_value(rounding=ROUND_CEILING)
        )
        commitment = prize_coefficient * Decimal(prize_bucket) * BASE_UNIT + gate_term
        nav_units_needed = int(
            (commitment / (budget_fraction * BASE_UNIT)).to_integral_value(
                rounding=ROUND_CEILING
            )
        )
        first_in_bucket = bucket_size * (prize_bucket - 1) + 1
        nav_units = max(first_in_bucket, nav_units_needed)
        candidate = Decimal(nav_units) * BASE_UNIT
        if candidate < scaled_start:
            candidate = _round_threshold_up(scaled_start)

    trial = replace(params, pol_budget_epoch=budget_fraction)
    if scaled_commitment(name, candidate, params=trial) > epoch_budget(candidate, trial):
        raise SlateError("integer funding frontier failed its defining inequality")
    return candidate


def funding_frontier(
    proposal_class: ProposalClass | str = "code",
    params: SlateParams = DEFAULTS,
) -> FundingFrontier:
    """Smallest lawful Perbill value that funds this linear class at any NAV."""
    params.validate()
    name = _class_name(proposal_class)
    if name == "param":
        raise SlateError("PARAM has no positive asymptotic commitment slope")
    slope = asymptotic_commitment_slope(name, params)
    raw_ppb = slope * PERBILL_DENOMINATOR
    minimum_ppb = int(raw_ppb.to_integral_value(rounding=ROUND_CEILING))
    fraction = Decimal(minimum_ppb) / PERBILL_DENOMINATOR
    # Equality never funds the four fixed gate books at finite NAV.
    if fraction <= slope:
        minimum_ppb += 1
        fraction = Decimal(minimum_ppb) / PERBILL_DENOMINATOR
    if fraction > POL_BUDGET_MAX:
        raise SlateError("13 §1's pol.budget_epoch ceiling cannot fund this class")
    threshold = funding_nav_threshold(name, fraction, params)
    ceiling_threshold = funding_nav_threshold(name, POL_BUDGET_MAX, params)
    assert threshold is not None and ceiling_threshold is not None
    return FundingFrontier(
        name,
        minimum_ppb,
        fraction,
        threshold,
        ceiling_threshold,
        slope,
    )


def largest_fundable_treasury_ask(
    nav: Decimal,
    params: SlateParams = DEFAULTS,
) -> Decimal | None:
    """Largest TREASURY ask whose §5.3 commitment fits §4.4's epoch budget.

    The inversion is exact: solve §3's commitment for ``b``, then §5.3's
    ``b=b_floor*Ask/P_ref`` for Ask.  ``None`` means even floor depth does not
    fit, so there is no fundable ask (an ask of zero still opens the books).
    """
    params.validate()
    budget = epoch_budget(nav, params)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        b_allowed = (budget / LN2 - Decimal(4) * params.gate_b) / Decimal(2)
        if b_allowed < B_FLOORS["treasury"]:
            return None
        return +(p_ref("treasury") * b_allowed / B_FLOORS["treasury"])


@dataclass(frozen=True)
class SizingExample:
    """08 §5.4's exactly-grade worked tuple."""

    proposal_class: ProposalClass
    prize: Decimal
    b: Decimal
    pol_depth: Decimal
    contest_capital: Decimal
    liquidity_hat: Decimal
    attack_cost: Decimal
    requirement: Decimal
    passes: bool


def worked_sizing_example(
    proposal_class: ProposalClass | str,
    *,
    nav: Decimal,
    ask: Decimal | None = None,
    flow_cap: Decimal = SEC_FLOW_CAP_MIN,
    upgrade_payload: bool = True,
    params: SlateParams = DEFAULTS,
) -> SizingExample:
    """08 §5.4 through treasury.py's owned security-sizing primitives.

    The default ``flow_cap=7`` is deliberate: §5.4 computes at the lawful
    minimum because the unsafe direction of this gate parameter is upward.
    """
    name = _class_name(proposal_class)
    prize = proposal_prize(
        name,
        nav,
        ask=ask,
        upgrade_payload=upgrade_payload,
        params=params,
    )
    b = pol_b(name, prize)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        depth = +(Decimal(2) * b * LN2)
        contest = dec_v_min(name, prize)
        liquidity = l_hat(depth, contest, flow_cap, b, b)
        attack = attack_cost_hat(liquidity)
        required = +(Decimal(3) * prize)
    return SizingExample(
        name,
        prize,
        b,
        depth,
        contest,
        liquidity,
        attack,
        required,
        security_sizing_ok(prize, attack),
    )


def class_margin_ratio(proposal_class: ProposalClass | str) -> Decimal:
    """08 §5.4(a)'s ``b_floor*ln(2)/P_ref`` parenthetical."""
    name = _class_name(proposal_class)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(B_FLOORS[name] * LN2 / p_ref(name))


# ---------------------------------------------------------------------------
# 08 §4.4 — bond-priority prefix versus maximum-cardinality packing.
# ---------------------------------------------------------------------------


def proposal_bond(
    proposal_class: ProposalClass | str,
    ask: Decimal = Decimal(0),
) -> Decimal:
    """13 §1 class bond, including TREASURY's kernel 0.5 %-of-Ask surcharge."""
    name = _class_name(proposal_class)
    ask = _d(ask)
    if ask < 0:
        raise SlateError("negative TREASURY ask")
    bond = PROP_BOND[name]
    if name == "treasury":
        bond += TREASURY_BOND_ASK_FRACTION * ask
    return bond


@dataclass(frozen=True)
class Proposal:
    """The fields §4.4 needs after qualification."""

    pid: int
    proposal_class: ProposalClass
    commitment: Decimal
    bond: Decimal
    attacker: bool = False


def make_proposal(
    proposal_class: ProposalClass | str,
    pid: int,
    *,
    nav: Decimal | None = None,
    ask: Decimal = Decimal(0),
    scaled: bool = False,
    upgrade_payload: bool = False,
    attacker: bool = False,
    params: SlateParams = DEFAULTS,
) -> Proposal:
    """Construct a floor proposal, or a §5.3-scaled capacity-edge proposal."""
    name = _class_name(proposal_class)
    commitment = (
        scaled_commitment(
            name,
            nav if nav is not None else Decimal(0),
            ask=ask if name == "treasury" else None,
            upgrade_payload=upgrade_payload,
            params=params,
        )
        if scaled
        else floor_commitment(name, params)
    )
    return Proposal(pid, name, commitment, proposal_bond(name, ask), attacker)


def bond_priority(slate: Iterable[Proposal]) -> tuple[Proposal, ...]:
    """05 §2.1 T5: bond descending, then pid ascending."""
    return tuple(sorted(slate, key=lambda p: (-p.bond, p.pid)))


def funded_prefix(slate: Iterable[Proposal], budget: Decimal) -> tuple[Proposal, ...]:
    """08 §4.4: drop reverse bond priority until the remaining prefix fits."""
    budget = _d(budget)
    if budget < 0:
        raise SlateError("negative POL budget")
    funded = list(bond_priority(slate))
    total = sum((p.commitment for p in funded), Decimal(0))
    while funded and total > budget:
        total -= funded.pop().commitment
    return tuple(funded)


def max_fundable(slate: Iterable[Proposal], budget: Decimal) -> tuple[Proposal, ...]:
    """Maximum-cardinality packing: cheapest commitment first.

    Every commitment is non-negative and every proposal has equal cardinality
    value, so this greedy order is the exact cardinality optimum, not a
    heuristic knapsack.
    """
    budget = _d(budget)
    if budget < 0:
        raise SlateError("negative POL budget")
    candidates = sorted(slate, key=lambda p: (p.commitment, p.pid))
    funded: list[Proposal] = []
    total = Decimal(0)
    for proposal in candidates:
        if total + proposal.commitment > budget:
            break
        funded.append(proposal)
        total += proposal.commitment
    return tuple(funded)


def _multisets(max_size: int) -> tuple[tuple[ProposalClass, ...], ...]:
    rows: list[tuple[ProposalClass, ...]] = [()]
    for size in range(1, max_size + 1):
        rows.extend(combinations_with_replacement(CLASS_ORDER, size))
    return tuple(rows)


def _floor_slate(classes: Sequence[ProposalClass], params: SlateParams) -> tuple[Proposal, ...]:
    return tuple(make_proposal(cls, pid, params=params) for pid, cls in enumerate(classes))


@dataclass(frozen=True)
class AdditionWitness:
    nav: Decimal
    base: tuple[ProposalClass, ...]
    expanded: tuple[ProposalClass, ...]
    base_funded: int
    expanded_funded: int

    @property
    def drop(self) -> int:
        return self.base_funded - self.expanded_funded


@dataclass(frozen=True)
class PackingWitness:
    nav: Decimal
    slate: tuple[ProposalClass, ...]
    prefix_funded: int
    optimum_funded: int

    @property
    def gap(self) -> int:
        return self.optimum_funded - self.prefix_funded


@dataclass(frozen=True)
class NavWitness:
    slate: tuple[ProposalClass, ...]
    lower_nav: Decimal
    higher_nav: Decimal
    lower_funded: int
    higher_funded: int

    @property
    def drop(self) -> int:
        return self.lower_funded - self.higher_funded


@dataclass(frozen=True)
class ShrinkSearch:
    """Exhaustive results over every class multiset up to ``epoch.slots``."""

    addition: AdditionWitness
    packing: PackingWitness
    nav: NavWitness
    combinations_checked: int


def search_shrink(
    nav_grid: Iterable[Decimal],
    params: SlateParams = DEFAULTS,
) -> ShrinkSearch:
    """Exhaust §4.4 over every floor-depth multiset and supplied NAV point."""
    params.validate()
    navs = tuple(sorted({_d(nav) for nav in nav_grid}))
    if not navs:
        raise SlateError("empty NAV grid")
    if navs[0] < max(NAV_FLOORS.values()):
        raise SlateError("NAV grid includes a point below a §4.1 class floor")
    multisets = _multisets(params.epoch_slots)
    empty_add = AdditionWitness(navs[0], (), (), 0, 0)
    empty_pack = PackingWitness(navs[0], (), 0, 0)
    empty_nav = NavWitness((), navs[0], navs[0], 0, 0)
    worst_add, worst_pack, worst_nav = empty_add, empty_pack, empty_nav
    counts: dict[tuple[Decimal, tuple[ProposalClass, ...]], int] = {}

    for nav in navs:
        budget = epoch_budget(nav, params)
        for classes in multisets:
            slate = _floor_slate(classes, params)
            prefix_count = len(funded_prefix(slate, budget))
            optimum_count = len(max_fundable(slate, budget))
            counts[(nav, classes)] = prefix_count
            candidate_pack = PackingWitness(
                nav, classes, prefix_count, optimum_count
            )
            if candidate_pack.gap > worst_pack.gap:
                worst_pack = candidate_pack

        for base in multisets:
            if len(base) >= params.epoch_slots:
                continue
            for added in CLASS_ORDER:
                expanded = tuple(sorted(base + (added,), key=CLASS_ORDER.index))
                candidate_add = AdditionWitness(
                    nav,
                    base,
                    expanded,
                    counts[(nav, base)],
                    counts[(nav, expanded)],
                )
                if candidate_add.drop > worst_add.drop:
                    worst_add = candidate_add

    for classes in multisets:
        for lower, higher in zip(navs, navs[1:]):
            candidate_nav = NavWitness(
                classes,
                lower,
                higher,
                counts[(lower, classes)],
                counts[(higher, classes)],
            )
            if candidate_nav.drop > worst_nav.drop:
                worst_nav = candidate_nav

    return ShrinkSearch(
        worst_add,
        worst_pack,
        worst_nav,
        len(navs) * len(multisets),
    )


# ---------------------------------------------------------------------------
# 05 §2.1 + 08 §7 — blanking economics and terminal rollover.
# ---------------------------------------------------------------------------


def qualified_prefix(
    submissions: Iterable[Proposal],
    slots: int = EPOCH_SLOTS_DEFAULT,
) -> tuple[Proposal, ...]:
    """05 §2.1 T5 qualification: the first ``slots`` in bond/PID priority."""
    if slots <= 0:
        raise SlateError("slots must be positive")
    return bond_priority(submissions)[:slots]


@dataclass(frozen=True)
class BlankingPlan:
    proposal_class: ProposalClass
    submitted: int
    funded_attackers: int
    funding_accounts: int
    per_epoch_cost: Decimal
    nav: Decimal
    required_phase: int
    blanked: bool

    @property
    def two_epoch_cost(self) -> Decimal:
        return Decimal(2) * self.per_epoch_cost


def blanking_plan(
    nav: Decimal,
    proposal_class: ProposalClass | str,
    count: int,
    *,
    honest_class: ProposalClass | str = "param",
    params: SlateParams = DEFAULTS,
) -> BlankingPlan:
    """Price one homogeneous attacker slate against five honest proposals.

    Attacker PIDs precede honest PIDs, the adversarial side of §2.1's explicit
    tie-break.  Dropped attacker entries take T6/T26 and are fully refunded;
    only funded junk is charged the §7 non-decision-grade slash.
    """
    params.validate()
    name = _class_name(proposal_class)
    honest_name = _class_name(honest_class)
    if count <= 0 or count > params.epoch_slots:
        raise SlateError("attacker count outside 1..epoch.slots")
    attackers = tuple(
        make_proposal(name, pid, attacker=True, params=params)
        for pid in range(count)
    )
    honest = tuple(
        make_proposal(honest_name, count + pid, params=params)
        for pid in range(params.epoch_slots)
    )
    qualified = qualified_prefix(attackers + honest, params.epoch_slots)
    funded = funded_prefix(qualified, epoch_budget(nav, params))
    funded_attackers = sum(proposal.attacker for proposal in funded)
    blanked = not any(not proposal.attacker for proposal in funded)
    cost = sum(
        (
            proposal.bond * params.intake_slash_fraction
            for proposal in funded
            if proposal.attacker
        ),
        Decimal(0),
    )
    accounts = -(-count // params.intake_max_acct)
    return BlankingPlan(
        name,
        count,
        funded_attackers,
        accounts,
        cost,
        _d(nav),
        CLASS_ARMING_PHASE[name],
        blanked,
    )


def class_blanking_attack(
    nav: Decimal,
    proposal_class: ProposalClass | str,
    *,
    honest_class: ProposalClass | str = "param",
    params: SlateParams = DEFAULTS,
) -> BlankingPlan | None:
    """Cheapest blank using one attacker class and enough funded accounts."""
    name = _class_name(proposal_class)
    candidates = (
        blanking_plan(nav, name, count, honest_class=honest_class, params=params)
        for count in range(1, params.epoch_slots + 1)
    )
    blanked = [plan for plan in candidates if plan.blanked]
    if not blanked:
        return None
    return min(
        blanked,
        key=lambda plan: (
            plan.per_epoch_cost,
            plan.submitted,
            plan.funding_accounts,
        ),
    )


def cheapest_blanking_attack(
    nav: Decimal,
    *,
    honest_class: ProposalClass | str = "param",
    max_phase: int = 6,
    params: SlateParams = DEFAULTS,
) -> BlankingPlan | None:
    """Minimum-cost homogeneous attack among the classes armed by ``max_phase``."""
    candidates = [
        plan
        for name in CLASS_ORDER
        if CLASS_ARMING_PHASE[name] <= max_phase
        for plan in [
            class_blanking_attack(
                nav, name, honest_class=honest_class, params=params
            )
        ]
        if plan is not None
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda plan: (
            plan.per_epoch_cost,
            plan.required_phase,
            CLASS_ORDER.index(plan.proposal_class),
        ),
    )


@dataclass(frozen=True)
class RolloverRun:
    """05 §2.1's first and exhausting deferral, read from lifecycle.py."""

    first: Config
    terminal: Config
    transition_tags: tuple[str, str]
    attacker_cost: Decimal


def two_epoch_blanking_run(plan: BlankingPlan) -> RolloverRun:
    """Carry an honest screened proposal through T6 then T26 under two blanks."""
    first = fire(Config("Screening"), BY_TAG["T6"])
    # T3 returns the re-anchored Submitted proposal to Screening next epoch;
    # retaining T6's `deferred_once` flag is the load-bearing composition.
    second_screening = Config("Screening", first.flags)
    terminal = fire(second_screening, BY_TAG["T26"])
    return RolloverRun(
        first,
        terminal,
        (BY_TAG["T6"].tag, BY_TAG["T26"].tag),
        plan.two_epoch_cost,
    )


@dataclass(frozen=True)
class IntakeCostTable:
    """08 §7's three rows, derived from the 13 §1 schedule."""

    intake_locked: Decimal
    intake_slashed: Decimal
    slot_locked: Decimal
    slot_slashed: Decimal
    combined_locked: Decimal
    combined_slashed: Decimal
    intake_accounts: int


def intake_cost_table(params: SlateParams = DEFAULTS) -> IntakeCostTable:
    """Recompute §7's published PARAM-queue + CODE-slot schedule."""
    params.validate()
    intake_locked = Decimal(INTAKE_QUEUE) * proposal_bond("param")
    slot_locked = Decimal(params.epoch_slots) * proposal_bond("code")
    return IntakeCostTable(
        intake_locked,
        intake_locked * params.intake_slash_fraction,
        slot_locked,
        slot_locked * params.intake_slash_fraction,
        intake_locked + slot_locked,
        (intake_locked + slot_locked) * params.intake_slash_fraction,
        -(-INTAKE_QUEUE // params.intake_max_acct),
    )


# ---------------------------------------------------------------------------
# Cross-document extraction and structured SQ-543 findings.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DocumentPrices:
    doc08_combined: Decimal
    doc14_th16: Decimal

    @property
    def agree(self) -> bool:
        return self.doc08_combined == self.doc14_th16


def _parse_compact_usdc(token: str) -> Decimal:
    cleaned = token.strip().lower().replace(",", "")
    multiplier = Decimal(1)
    if cleaned.endswith("k"):
        multiplier = Decimal(1_000)
        cleaned = cleaned[:-1]
    return Decimal(cleaned) * multiplier


def document_monopolization_prices(repo_root: Path) -> DocumentPrices:
    """Extract 08 §7's combined slash and 14 TH-16's recurring price.

    The figures are intentionally not module constants: this parser is the
    drift detector, following lifecycle.py's Mermaid-table precedent.
    """
    doc08 = (repo_root / "docs/architecture/08-treasury-and-economics.md").read_text(
        encoding="utf-8"
    )
    doc14 = (repo_root / "docs/architecture/14-threat-model.md").read_text(
        encoding="utf-8"
    )
    combined = re.search(
        r"\|\s*Combined monopolization\s*\|[^|]+\|\s*\*\*[^\d]*(\d[\d,]*(?:\.\d+)?)\*\*",
        doc08,
    )
    th16_row = next(
        (line for line in doc14.splitlines() if line.startswith("| TH-16 |")),
        None,
    )
    th16 = (
        re.search(r"forfeits\s+~([\d.]+k)\s+USDC", th16_row, re.IGNORECASE)
        if th16_row is not None
        else None
    )
    if combined is None or th16 is None:
        raise SlateError("cannot extract the 08 §7 / 14 TH-16 monopolization prices")
    return DocumentPrices(
        _parse_compact_usdc(combined.group(1)),
        _parse_compact_usdc(th16.group(1)),
    )


@dataclass(frozen=True)
class Finding:
    """One executable claim: ``ok`` says whether the document claim survives."""

    key: str
    ok: bool
    actual: Decimal | int | str
    required: Decimal | int | str


def check_claims(
    repo_root: Path,
    nav: Decimal = Decimal(25_000_000),
    params: SlateParams = DEFAULTS,
) -> tuple[Finding, ...]:
    """Queryable SQ-543 results; false rows are evidence, not test failures."""
    nav = _d(nav)
    code_commitment = scaled_commitment("code", nav, params=params)
    budget = epoch_budget(nav, params)
    fundable_ask = largest_fundable_treasury_ask(nav, params)
    admitted_ask = params.cap_proposal * nav
    shrink = search_shrink((max(max(NAV_FLOORS.values()), nav),), params)
    attack = cheapest_blanking_attack(nav, params=params)
    prices = document_monopolization_prices(repo_root)
    margins = {name: class_margin_ratio(name) for name in CLASS_ORDER}
    invariant = all(
        abs(margins[name] - margins[CLASS_ORDER[0]]) <= Decimal("1e-80")
        for name in CLASS_ORDER[1:]
    )
    assert attack is not None
    return (
        Finding(
            "scaled CODE commitment fits pol.budget_epoch",
            code_commitment <= budget,
            code_commitment,
            budget,
        ),
        Finding(
            "maximum TREASURY ask is POL-fundable",
            fundable_ask is not None and admitted_ask <= fundable_ask,
            fundable_ask if fundable_ask is not None else "no fundable ask",
            admitted_ask,
        ),
        Finding(
            "bond-priority prefix maximizes funded count",
            shrink.packing.gap == 0,
            shrink.packing.prefix_funded,
            shrink.packing.optimum_funded,
        ),
        Finding(
            "every monopolization path costs five figures per epoch",
            attack.per_epoch_cost >= Decimal(10_000),
            attack.per_epoch_cost,
            Decimal(10_000),
        ),
        Finding(
            "08 §7 and 14 TH-16 publish one monopolization price",
            prices.agree,
            prices.doc14_th16,
            prices.doc08_combined,
        ),
        Finding(
            "b_floor*ln2/P_ref is class-invariant",
            invariant,
            margins["meta"],
            margins["code"],
        ),
    )
