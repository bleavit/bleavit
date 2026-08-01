"""05 §4.3, §4.5, §4.7, §5.1 — pillar reachability and launch vetoes.

Doc 05 publishes the v1 pillar formulas, the phase-keyed collator cap, daily
breach flags and the gate veto. Doc 07 §8 supplies the reserve probe's
fail-static daily value; doc 08 §10 supplies the separate claim that launch
*trading/revenue* volume is zero. This module executes their composition.

Four results fall out.

* With the six declared ``C_onchain`` weights, the analytic single-component
  frontier is **0.035290537142853633…**. The smallest weight is ``K = 0.05``,
  **1.4168103987…×** the frontier, so every component at zero breaches the
  daily C floor by itself.
* Under independent, identically distributed failures and complete recording
  of all 42 days, the 5% absolute veto binds above a daily failure rate of
  **0.0012205234686…**: one failure day per **819.3206 days**, or **2.2432
  years**. That is a scenario threshold, not a protocol reliability bound.
  Section 4.7 deliberately permits one recorded day per measurement epoch and
  supplies no independence assumption; at that two-day minimum the analogous
  IID threshold is 0.0253205655… instead.
* SQ-555's unconditional launch-wedge premise does **not** follow from doc 08.
  Its zero ``volume`` is fee/revenue-generating trading volume, while ``U``
  counts any block carrying a non-inherent extrinsic. No document supplies the
  launch non-empty-block fraction. Under the explicit additional assumption
  that it is zero for every measured day, however, Phase 4 gives ``U = 0.25``,
  ``D_eff = 0.96``, ``W = 0``, ``s = 1e-9`` and the real ordered decision rule
  returns ``GateVetoSurvival`` before the welfare sanity-band rejection. The
  fast escape is operational but demanding: **13/15 = 86⅔%** of relay slots
  must carry a non-inherent extrinsic merely to avoid the daily flag. At that
  exact floor ``g(S)`` is still zero; with best-case C/P/A and five equal Phase
  4 collators, the first whole-day occupancy that is decision-grade is
  **12,610/14,400 = 87.5694…%** (12,609 still fails the sanity band), established
  before a measured day and then maintained. The slower structural escape is
  the non-market-bearing ``metric`` track: its tabled 32-day path plus the
  two-epoch activation lead is 74 days at the default epoch length.
* Doc 05's old-reference worked pair reproduces exactly on the FixedU64 grid:
  an equal five-collator set at ``n_cap = 8`` gives ``D_eff = 0.914285714`` and
  ``g(S) = 0.084274776``. The phase ladder is monotone, but it is not bound to
  the actual set size or to a resolved ``collator.n_target`` schedule: that
  registry row remains ``[VERIFY]`` and doc 09's phase exits name no count
  criterion. Holding four equal authors while advancing to Phase 4 therefore
  makes the survival gate exactly zero.

Units: probabilities, pillar values, HHI and weights are dimensionless;
cadences are days or blocks. Rational occupancy thresholds use ``Fraction``.
Transcendentals use 100-digit ``Decimal`` working precision. The imported
welfare pipeline applies doc 05's downward FixedU64/64.64 floors, the direction
against an adopting claimant; required block counts round **up** for the same
reason. No binary float is used.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal, localcontext
from fractions import Fraction
from typing import Mapping, Sequence

from . import decision, welfare

WORK_PREC = 100
ZERO = Decimal(0)
ONE = Decimal(1)

# ---------------------------------------------------------------------------
# 13 §1 registry values and bounds used by these checks.
# ---------------------------------------------------------------------------

# 13 §1 `gate.p_max` (S, C): default 0.05, kernel ceiling 0.10.
GATE_P_MAX_DEFAULT = Decimal("0.05")
GATE_P_MAX_CEILING = Decimal("0.10")
# 13 §1 `gate.eps`: default 0.02.
GATE_EPS_DEFAULT = Decimal("0.02")

# 13 §1 `welfare.thS_lo` / `welfare.thS_hi`.
WELFARE_TH_S_LO = welfare.THETA_S_LO
WELFARE_TH_S_HI = welfare.THETA_S_HI
# 13 §1 `welfare.thC_lo` / `welfare.thC_hi`.
WELFARE_TH_C_LO = welfare.THETA_C_LO
WELFARE_TH_C_HI = welfare.THETA_C_HI

# 13 §1 `epoch.length`: 302,400 blocks = 21 days at 14,400 blocks/day.
BLOCKS_PER_DAY = 14_400
EPOCH_LENGTH_BLOCKS = 302_400
EPOCH_DAYS = EPOCH_LENGTH_BLOCKS // BLOCKS_PER_DAY
MEASUREMENT_EPOCHS = 2  # 05 §5.1: e+1 through e+2.
FULL_GATE_WINDOW_DAYS = EPOCH_DAYS * MEASUREMENT_EPOCHS
# 05 §4.7: one recorded day in each measurement epoch satisfies coverage.
MIN_RECORDED_GATE_DAYS = MEASUREMENT_EPOCHS

# 13 §1 `res.probe_int`: 14,400 blocks, one probe per epoch day.
RES_PROBE_INTERVAL_BLOCKS = 14_400

# 13 §1 `collator.n_min`: default 4, bounds [3, 12].
COLLATOR_N_MIN_DEFAULT = 4
COLLATOR_N_MIN_MIN = 3
COLLATOR_N_MIN_MAX = 12
# 13 §1 `collator.n_target`: launch 5, bounds [4, 12], schedule [VERIFY].
COLLATOR_N_TARGET_DEFAULT = 5
COLLATOR_N_TARGET_MIN = 4
COLLATOR_N_TARGET_MAX = 12

# 05 §4.3 / §4.4: canonical C_onchain weights and epsilon.
C_ONCHAIN_WEIGHTS: dict[str, Decimal] = {
    "X": Decimal("0.25"),
    "R": Decimal("0.25"),
    "E": Decimal("0.20"),
    "H": Decimal("0.15"),
    "Pi": Decimal("0.10"),
    "K": Decimal("0.05"),
}
EPSILON_C = welfare.EPSILON_C

# 05 §4.3.2: empty blocks receive 25% credit; H targets 40% utilization;
# each qualifying integrity failure subtracts 0.25.
EMPTY_BLOCK_WEIGHT = Fraction(1, 4)
HEADROOM_TARGET = Decimal("0.40")
INTEGRITY_EVENT_PENALTY = Decimal("0.25")

# 06 §2.1 `metric` track: 2 d prepare / 14 d decision / 2 d confirm,
# 14 d enactment, then 05 §4.4 activation at least two epochs out.
METRIC_PREPARE_DAYS = 2
METRIC_DECISION_DAYS = 14
METRIC_CONFIRM_DAYS = 2
METRIC_ENACTMENT_DAYS = 14
METRIC_ACTIVATION_EPOCHS = 2


class PillarReachabilityError(ValueError):
    """A pillar claim whose required input is absent or invalid refuses."""


def _decimal(value: Decimal | Fraction | int) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, Fraction):
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            return Decimal(value.numerator) / Decimal(value.denominator)
    return Decimal(value)


def _fraction(value: Decimal | Fraction | int) -> Fraction:
    return value if isinstance(value, Fraction) else Fraction(value)


def _ceil_fraction(value: Fraction) -> int:
    if value < 0:
        raise PillarReachabilityError("cannot ceil a negative occupancy")
    return -(-value.numerator // value.denominator)


# ---------------------------------------------------------------------------
# 05 §4.3 / §4.4: the C_daily single-component frontier.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FrontierComponent:
    component: str
    normalized_weight: Decimal
    c_daily_when_zero: Decimal
    breaches: bool


@dataclass(frozen=True)
class CDailyFrontier:
    """The analytic frontier and the actual FixedU64 result per component."""

    frontier: Decimal
    components: tuple[FrontierComponent, ...]
    smallest_weight: Decimal
    smallest_to_frontier: Decimal

    @property
    def every_component_is_single_point_of_failure(self) -> bool:
        return all(component.breaches for component in self.components)


def c_daily_frontier(
    weights: Mapping[str, Decimal],
    eps_c: Decimal = EPSILON_C,
    theta_c_min: Decimal = WELFARE_TH_C_LO,
) -> CDailyFrontier:
    """Solve ``eps_c**w < theta_c_min`` and evaluate every declared weight.

    ``C_daily`` renormalizes over the on-chain subset. The analytic exponent
    is therefore ``w_i / sum(weights)`` and the strict breach frontier is
    ``ln(theta_c_min) / ln(eps_c)``. The per-component value is additionally
    evaluated by :func:`welfare.weighted_geometric`, so the result includes the
    normative unsigned-Q64 renormalization and FixedU64 floor rather than only
    abstract real arithmetic.
    """
    if not weights:
        raise PillarReachabilityError("C_daily needs at least one component")
    eps_c, theta_c_min = Decimal(eps_c), Decimal(theta_c_min)
    if not ZERO < eps_c < theta_c_min < ONE:
        raise PillarReachabilityError("need 0 < eps_C < theta_C_min < 1")
    if any(Decimal(weight) <= ZERO for weight in weights.values()):
        raise PillarReachabilityError("component weights must be positive")

    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        total = sum((Decimal(weight) for weight in weights.values()), ZERO)
        frontier = theta_c_min.ln() / eps_c.ln()
        rows: list[FrontierComponent] = []
        for component in sorted(weights):
            normalized = Decimal(weights[component]) / total
            values = {key: ONE for key in weights}
            values[component] = ZERO
            actual = welfare.weighted_geometric(
                values, weights, eps_c, renormalize=True
            )
            rows.append(
                FrontierComponent(
                    component,
                    normalized,
                    actual,
                    actual < theta_c_min,
                )
            )
        smallest = min(row.normalized_weight for row in rows)
        return CDailyFrontier(
            frontier,
            tuple(rows),
            smallest,
            smallest / frontier,
        )


# ---------------------------------------------------------------------------
# 05 §4.3 and 07 §8: enumerated daily failure modes.
# ---------------------------------------------------------------------------


def xcm_health(accepted: int, local_failures: int, probe_timeouts: int) -> Decimal:
    """05 §4.3: accepted / (accepted + local failures + probe timeouts)."""
    if min(accepted, local_failures, probe_timeouts) < 0:
        raise PillarReachabilityError("XCM counters must be non-negative")
    total = accepted + local_failures + probe_timeouts
    if total == 0:
        return ONE  # 05 §4.3: no traffic => 1.
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return welfare.floor_fixed(Decimal(accepted) / Decimal(total))


def weight_headroom(mean_utilization: Decimal) -> Decimal:
    """05 §4.3.2's affine H map after per-block utilization reduction."""
    utilization = Decimal(mean_utilization)
    if not ZERO <= utilization <= ONE:
        raise PillarReachabilityError("mean utilization must be in [0, 1]")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        value = (ONE - utilization) / (ONE - HEADROOM_TARGET)
        return welfare.floor_fixed(min(ONE, max(ZERO, value)))


def runtime_integrity(defensive_failure_events: int) -> Decimal:
    """05 §4.3.2: max(0, 1 - 0.25 * qualifying events)."""
    if defensive_failure_events < 0:
        raise PillarReachabilityError("defensive failure count must be non-negative")
    return welfare.floor_fixed(
        max(
            ZERO,
            ONE - INTEGRITY_EVENT_PENALTY * defensive_failure_events,
        )
    )


def collator_adequacy(
    distinct_active_authors: int,
    n_min: int = COLLATOR_N_MIN_DEFAULT,
) -> Decimal:
    """05 §4.3: K = min(1, distinct active authors / collator.n_min)."""
    if distinct_active_authors < 0 or n_min <= 0:
        raise PillarReachabilityError("collator counts must be non-negative")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return welfare.floor_fixed(
            min(ONE, Decimal(distinct_active_authors) / Decimal(n_min))
        )


@dataclass(frozen=True)
class FailureMode:
    """One explicitly specified failure and its C_onchain component effects."""

    key: str
    description: str
    effects: tuple[tuple[str, Decimal], ...]

    def c_daily(self, weights: Mapping[str, Decimal] = C_ONCHAIN_WEIGHTS) -> Decimal:
        values = {component: ONE for component in weights}
        for component, value in self.effects:
            if component not in values:
                raise PillarReachabilityError(
                    f"failure mode {self.key} names unknown component {component}"
                )
            values[component] = value
        return welfare.weighted_geometric(
            values, weights, EPSILON_C, renormalize=True
        )

    def breaches(self, theta_c_min: Decimal = WELFARE_TH_C_LO) -> bool:
        return self.c_daily() < theta_c_min


def enumerated_failure_modes() -> tuple[FailureMode, ...]:
    """The concrete C_onchain failures enumerated by 05 §4.3 and 07 §8.

    Reserve timeout affects both R and X: 05 §4.3 includes probe timeouts in
    X's denominator, while 07 §8 makes the same timeout a fail-static R = 0.
    Other reserve failures affect R alone. The H, Pi and K rows use the exact
    inputs at which their published formulas reach zero.
    """
    zero_x_local = xcm_health(0, 1, 0)
    zero_x_timeout = xcm_health(0, 0, 1)
    zero_h = weight_headroom(ONE)
    zero_pi = runtime_integrity(4)
    zero_k = collator_adequacy(0)
    return (
        FailureMode(
            "xcm.local_send_failure",
            "one local send failure and no accepted send in the day",
            (("X", zero_x_local),),
        ),
        FailureMode(
            "reserve.error_response",
            "an explicit error response to the daily reserve probe",
            (("R", ZERO),),
        ),
        FailureMode(
            "reserve.timeout",
            "no authenticated success before res.probe_timeout",
            (("X", zero_x_timeout), ("R", ZERO)),
        ),
        FailureMode(
            "reserve.no_attempt",
            "no attempt opened for a completed cadence slot (keeper outage)",
            (("R", ZERO),),
        ),
        FailureMode(
            "reserve.malformed",
            "a malformed reserve-probe response",
            (("R", ZERO),),
        ),
        FailureMode(
            "reserve.ambiguous",
            "an ambiguous reserve-probe result",
            (("R", ZERO),),
        ),
        FailureMode(
            "security.zero_coverage",
            "every same-asset economic-security coverage ratio is zero",
            (("E", ZERO),),
        ),
        FailureMode(
            "headroom.saturated",
            "mean block utilization reaches 100 percent",
            (("H", zero_h),),
        ),
        FailureMode(
            "integrity.four_failures",
            "four qualifying irrecoverable defensive failures in the window",
            (("Pi", zero_pi),),
        ),
        FailureMode(
            "collators.no_active_author",
            "no distinct active author in the window",
            (("K", zero_k),),
        ),
    )


# ---------------------------------------------------------------------------
# 05 §5.1: daily failure probability -> gate-veto decision.
# ---------------------------------------------------------------------------


def flag_probability(per_day_failure: Decimal, days: int) -> Decimal:
    """``1 - (1-q)**days`` under an explicit IID/full-recording assumption."""
    q = Decimal(per_day_failure)
    if not ZERO <= q <= ONE:
        raise PillarReachabilityError("daily failure probability must be in [0, 1]")
    if days <= 0:
        raise PillarReachabilityError("days must be positive")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return ONE - (ONE - q) ** days


def critical_per_day_rate(p_max: Decimal, days: int) -> Decimal:
    """Invert ``1 - (1-q)**days = p_max`` at 100-digit precision.

    The gate rule is strict (``p_adopt > p_max``), so equality itself does not
    veto. An irrational root has no finite Decimal representation; the result
    is therefore moved down by working-precision ulps until composing it back
    through :func:`flag_probability` is ``<= p_max``. That is both coherent
    with the strict boundary and conservative against an adopting claimant.
    """
    p_max = Decimal(p_max)
    if not ZERO <= p_max <= ONE:
        raise PillarReachabilityError("p_max must be in [0, 1]")
    if days <= 0:
        raise PillarReachabilityError("days must be positive")
    if p_max in (ZERO, ONE):
        return p_max
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        root = ONE - ((ONE - p_max).ln() / Decimal(days)).exp()
        probability = ONE - (ONE - root) ** days
        while probability > p_max:
            root = ctx.next_minus(root)
            probability = ONE - (ONE - root) ** days
        return root


def _decision_from_gate_probabilities(
    p_adopt: Decimal,
    p_reject: Decimal,
    gate: decision.Gate,
    *,
    welfare_grade: decision.Grade = decision.Grade.OK,
) -> decision.Decision:
    """Run the real ordered engine with every unrelated check made passing."""
    return decision.decide(
        accept_full=ONE,
        reject_full_effective=ZERO,
        delta=ZERO,
        gate_valid={decision.Gate.SURVIVAL: True, decision.Gate.SECURITY: True},
        p_adopt={gate: p_adopt},
        p_reject={gate: p_reject},
        p_max={gate: GATE_P_MAX_DEFAULT},
        eps={gate: GATE_EPS_DEFAULT},
        welfare_grade=welfare_grade,
        # TREASURY with ask = 0 has a zero in-cap prize, so step 9 passes even
        # with zero measured liquidity. This isolates the gate ordering.
        proposal_class=decision.ProposalClass.TREASURY,
        ask=ZERO,
        measured_liquidity=ZERO,
    )


def veto_decision(
    per_day_failure: Decimal,
    *,
    days: int = FULL_GATE_WINDOW_DAYS,
    gate: decision.Gate = decision.Gate.SECURITY,
    reject_per_day_failure: Decimal | None = None,
) -> decision.Decision:
    """Compose an IID daily rate through :func:`decision.decide`.

    By default the adopt and reject books receive the same system-wide base
    rate. That models a harmless proposal and makes the relative test inert;
    callers may supply a distinct reject rate to exercise causal differences.
    It is deliberately narrower than claiming the two conditional books are
    always equal — doc 05 does not make that claim.
    """
    reject_rate = (
        Decimal(per_day_failure)
        if reject_per_day_failure is None
        else Decimal(reject_per_day_failure)
    )
    return _decision_from_gate_probabilities(
        flag_probability(Decimal(per_day_failure), days),
        flag_probability(reject_rate, days),
        gate,
    )


def veto_binds(
    per_day_failure: Decimal,
    *,
    days: int = FULL_GATE_WINDOW_DAYS,
    gate: decision.Gate = decision.Gate.SECURITY,
    reject_per_day_failure: Decimal | None = None,
) -> bool:
    """Whether the composed decision stops at this gate's veto."""
    result = veto_decision(
        per_day_failure,
        days=days,
        gate=gate,
        reject_per_day_failure=reject_per_day_failure,
    )
    expected = (
        decision.RejectReason.GATE_VETO_SURVIVAL
        if gate is decision.Gate.SURVIVAL
        else decision.RejectReason.GATE_VETO_SECURITY
    )
    return result.reason is expected


@dataclass(frozen=True)
class FailureModeResult:
    mode: FailureMode
    c_daily: Decimal
    daily_breach: bool
    window_probability: Decimal
    veto: bool


def failure_mode_results(
    per_day_failure: Decimal,
    *,
    days: int = FULL_GATE_WINDOW_DAYS,
) -> tuple[FailureModeResult, ...]:
    """Evaluate and pass every enumerated failure mode through the C veto."""
    probability = flag_probability(Decimal(per_day_failure), days)
    rows = []
    for mode in enumerated_failure_modes():
        value = mode.c_daily()
        breached = value < WELFARE_TH_C_LO
        rows.append(
            FailureModeResult(
                mode,
                value,
                breached,
                probability if breached else ZERO,
                breached
                and veto_binds(
                    Decimal(per_day_failure),
                    days=days,
                    gate=decision.Gate.SECURITY,
                ),
            )
        )
    return tuple(rows)


# ---------------------------------------------------------------------------
# 05 §4.3.2 + 08 §10: launch block occupancy and ordered consequences.
# ---------------------------------------------------------------------------


def non_empty_fraction_for(target: Decimal) -> Fraction:
    """Solve ``0.25 + 0.75*f = target`` exactly for healthy relay cadence."""
    target_fraction = _fraction(Decimal(target))
    if not EMPTY_BLOCK_WEIGHT <= target_fraction <= 1:
        raise PillarReachabilityError("target must lie in [empty weight, 1]")
    return (target_fraction - EMPTY_BLOCK_WEIGHT) / (1 - EMPTY_BLOCK_WEIGHT)


def non_empty_blocks_for(target: Decimal, relay_slots: int = BLOCKS_PER_DAY) -> int:
    """Minimum whole non-empty blocks clearing ``target``, rounded up."""
    if relay_slots <= 0:
        raise PillarReachabilityError("relay slot count must be positive")
    return _ceil_fraction(non_empty_fraction_for(target) * relay_slots)


def block_production_u(non_empty_fraction: Fraction) -> Decimal:
    """05 §4.3.2 U for a 1:1 authored-block/relay-slot cadence.

    Every remaining authored block is empty and receives 25% credit. A missed
    relay slot would increase the denominator without a block and can only
    lower U, so this is the optimistic value for a given non-empty fraction.
    """
    fraction = _fraction(non_empty_fraction)
    if not 0 <= fraction <= 1:
        raise PillarReachabilityError("non-empty fraction must be in [0, 1]")
    exact = EMPTY_BLOCK_WEIGHT + (1 - EMPTY_BLOCK_WEIGHT) * fraction
    return welfare.floor_fixed(_decimal(exact))


def hhi_equal(collator_set_size: int) -> Decimal:
    """HHI of equal authorship: ``n * (1/n)**2 = 1/n``."""
    if collator_set_size <= 0:
        raise PillarReachabilityError("collator set must be non-empty")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return ONE / Decimal(collator_set_size)


@dataclass(frozen=True)
class PillarParams:
    """A concrete operating configuration for the reachability composition."""

    phase: int = 4
    collator_set_size: int = COLLATOR_N_TARGET_DEFAULT
    # None is intentional: 08 §10 does not specify this input (SQ-555).
    non_empty_fraction: Fraction | None = None


LAUNCH = PillarParams()
ZERO_NON_INHERENT_LAUNCH = replace(LAUNCH, non_empty_fraction=Fraction(0))


@dataclass(frozen=True)
class LaunchOutcome:
    params: PillarParams
    u: Decimal
    hhi: Decimal
    d_eff: Decimal
    survival: Decimal
    survival_gate: Decimal
    welfare: Decimal
    settlement_score: Decimal
    daily_breach: bool
    welfare_grade: decision.Grade
    decision: decision.Decision


def launch_outcome(params: PillarParams) -> LaunchOutcome:
    """Compose occupancy -> D_eff -> gate -> W -> s -> ordered decision.

    C, P and A are fixed at their most favourable value 1, isolating survival.
    The configured daily occupancy is held constant across both 21-day
    measurement epochs; this persistence is an explicit scenario assumption,
    not a fact inferred from doc 08.
    """
    if params.non_empty_fraction is None:
        raise PillarReachabilityError(
            "08 §10 zero trading/revenue volume does not specify U's "
            "non-empty-block fraction (SQ-555)"
        )
    u = block_production_u(params.non_empty_fraction)
    hhi = hhi_equal(params.collator_set_size)
    d_eff = welfare.collator_d_eff(hhi, params.phase)
    survival = min(u, d_eff)  # v1 does not register F (05 §4.3.2).
    survival_gate = welfare.gate(
        survival, WELFARE_TH_S_LO, WELFARE_TH_S_HI
    )
    w = welfare.welfare_value(survival, ONE, ONE, ONE)
    score = welfare.settlement_score(w, w)
    grade = decision.grade_welfare_book(
        twap=score,
        spot_close=score,
        coverage=ONE,
        stale_events=0,
        pol_floor_met=True,
        pol_undisturbed=True,
        contest_capital=ONE,
        v_min=ONE,
    )
    daily_breach = survival < WELFARE_TH_S_LO
    p_breach = ONE if daily_breach else ZERO
    ordered = _decision_from_gate_probabilities(
        p_breach,
        p_breach,
        decision.Gate.SURVIVAL,
        welfare_grade=grade,
    )
    return LaunchOutcome(
        params,
        u,
        hhi,
        d_eff,
        survival,
        survival_gate,
        w,
        score,
        daily_breach,
        grade,
        ordered,
    )


def minimum_non_empty_blocks_for_decision(
    params: PillarParams = LAUNCH,
    relay_slots: int = BLOCKS_PER_DAY,
) -> int | None:
    """First whole-day occupancy that passes the isolated decision composition.

    The search is finite and exact over the day's integer block counts. It
    keeps the launch composition's favourable C/P/A and equal authorship, and
    treats the same occupancy as persistent through the future gate window.
    ``None`` means no occupancy in this phase/set configuration can pass.
    """
    if relay_slots <= 0:
        raise PillarReachabilityError("relay slot count must be positive")
    for non_empty in range(relay_slots + 1):
        candidate = replace(
            params,
            non_empty_fraction=Fraction(non_empty, relay_slots),
        )
        if launch_outcome(candidate).decision.outcome is decision.Outcome.ADOPT:
            return non_empty
    return None


@dataclass(frozen=True)
class ReachabilityFinding:
    key: str
    ok: bool
    detail: str


def check_launch_reachability(params: PillarParams = LAUNCH) -> tuple[ReachabilityFinding, ...]:
    """Queryable SQ-555 findings, including the missing launch premise."""
    if params.non_empty_fraction is None:
        return (
            ReachabilityFinding(
                "launch.non_empty_fraction specified",
                False,
                "08 §10 specifies zero trading/revenue volume, not the share "
                "of blocks carrying any non-inherent extrinsic; U is unknown",
            ),
        )
    outcome = launch_outcome(params)
    return (
        ReachabilityFinding(
            "launch.survival_gate clears",
            outcome.decision.reason
            is not decision.RejectReason.GATE_VETO_SURVIVAL,
            f"U={outcome.u}, D_eff={outcome.d_eff}, "
            f"decision={outcome.decision.reason}",
        ),
        ReachabilityFinding(
            "launch.welfare_book is decision-grade",
            outcome.welfare_grade is decision.Grade.OK,
            f"W={outcome.welfare}, s={outcome.settlement_score}, "
            f"grade={outcome.welfare_grade.value}",
        ),
    )


@dataclass(frozen=True)
class EscapeRoute:
    route: str
    market_bearing: bool
    governance_days: int
    activation_epochs: int
    epoch_days: int

    @property
    def tabled_total_days(self) -> int:
        return self.governance_days + self.activation_epochs * self.epoch_days


def metric_spec_escape(epoch_days: int = EPOCH_DAYS) -> EscapeRoute:
    """06 §2.1's non-market-bearing route to reshape the MetricSpec.

    The day count is the tabled prepare + decision + confirm + enactment path,
    followed by 05 §4.4's minimum activation lead. It is a schedule envelope,
    not a promise that voter support or epoch cranks arrive on time.
    """
    if epoch_days <= 0:
        raise PillarReachabilityError("epoch days must be positive")
    governance_days = (
        METRIC_PREPARE_DAYS
        + METRIC_DECISION_DAYS
        + METRIC_CONFIRM_DAYS
        + METRIC_ENACTMENT_DAYS
    )
    return EscapeRoute(
        "ConstitutionalValues metric track: welfare.register_spec",
        False,
        governance_days,
        METRIC_ACTIVATION_EPOCHS,
        epoch_days,
    )


# ---------------------------------------------------------------------------
# 05 §4.5: the phase × equal-collator-set grid.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DEffCell:
    phase: int
    collator_set_size: int
    n_cap: int
    hhi: Decimal
    d_eff: Decimal
    survival_gate: Decimal

    @property
    def collapsed(self) -> bool:
        return self.survival_gate == ZERO


def d_eff_grid(
    phases: Sequence[int], collator_set_sizes: Sequence[int]
) -> tuple[DEffCell, ...]:
    """Evaluate equal-authorship D_eff and g(S) in stable row-major order.

    ``U = 1`` is implicit, so the survival input is D_eff. Nothing in this
    function equates ``n_cap`` with ``collator.n_target``: doc 05 calls the
    former a phase-keyed constant, while the latter remains a live registry row
    with a ``[VERIFY]`` phase schedule.
    """
    rows: list[DEffCell] = []
    for phase in phases:
        n_cap = welfare.collator_n_cap(phase)
        for size in collator_set_sizes:
            hhi = hhi_equal(size)
            d_eff = welfare.collator_d_eff(hhi, phase)
            rows.append(
                DEffCell(
                    phase,
                    size,
                    n_cap,
                    hhi,
                    d_eff,
                    welfare.gate(d_eff, WELFARE_TH_S_LO, WELFARE_TH_S_HI),
                )
            )
    return tuple(rows)


def check_collator_reachability(
    phases: Sequence[int] = tuple(range(8)),
) -> tuple[ReachabilityFinding, ...]:
    """Queryable consequences of §4.5's phase schedule.

    The first row checks the section's unqualified sentence that five equal
    authors score ``D_eff = 1``. The second checks the operational property the
    schedule needs but no phase gate supplies: advancing while the actual set
    remains at the registry target's lawful minimum must not zero survival.
    """
    five = d_eff_grid(phases, (COLLATOR_N_TARGET_DEFAULT,))
    minimum = d_eff_grid(phases, (COLLATOR_N_TARGET_MIN,))
    return (
        ReachabilityFinding(
            "five equal authors remain neutralized",
            all(cell.d_eff == ONE for cell in five),
            "; ".join(
                f"phase {cell.phase}: D_eff={cell.d_eff}"
                for cell in five
                if cell.d_eff != ONE
            )
            or "D_eff=1 in every checked phase",
        ),
        ReachabilityFinding(
            "phase advance at target minimum keeps survival nonzero",
            all(not cell.collapsed for cell in minimum),
            "; ".join(
                f"phase {cell.phase}: n={cell.collator_set_size}, "
                f"D_eff={cell.d_eff}, g={cell.survival_gate}"
                for cell in minimum
                if cell.collapsed
            )
            or "no collapsed cell",
        ),
    )
