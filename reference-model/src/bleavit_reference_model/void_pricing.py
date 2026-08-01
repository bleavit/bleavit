"""00 D-1 redemption arithmetic and a non-normative VOID-price sensitivity.

D-1 values an unpaired branch-USDC at one half of USDC and an unpaired scalar
or gate leg at one quarter. The normative derivation in this module ends at
those payouts and their exact ratio: a VOID leg is worth one half of a
VOID branch-USDC in redemption units.

D-1 does **not** define a quote as expected leg payout divided by expected
branch-USDC payout, define ``pi`` or branch-resolution weights ``w``, or claim
that inventory-derived LMSR prices converge to that quotient. The rest of the
module is therefore explicitly a risk-neutral sensitivity. Every readout
carries :class:`RiskNeutralQuoteScenario`, including the otherwise-missing
assumption that quotes converge to an expected-value ratio.

Under that non-normative assumption, equal branch weights shrink an
ACCEPT-minus-REJECT uplift, while complementary asymmetric weights can produce
a hypothetical false ADOPT in the supplied scenario. SQ-559 records that
sensitivity without treating it as a mechanical specification contradiction.
The actionable document observation is narrower: 05 §5 reads raw TWAPs and no
document adopts a VOID-adjusted series.

The same execution corrects the worked-example sensitivity: `7/82`
(`8.5366… %`) is only the full-window hurdle equality.  The example first
ceases to ADOPT just above `23/398` (`5.7788… %`), when its stated trailing
uplift falls below the hurdle; the C-gate absolute veto follows at `11/161`.

The Baseline book is deliberately separate.  It has plain-USDC collateral and
05 §7 settles it at the fixed neutral score one half on cohort VOID.  Its pull
toward one half is therefore :func:`baseline_neutral_price`, not the D-1
quarter-over-half ratio used by :func:`leg_price`.

Units: all sensitivity inputs and outputs are exact probabilities or
branch-USDC quote hypotheses,
represented by :class:`fractions.Fraction`.  D-1 redemption of integer claim
amounts rounds down, against the claimant and in favour of escrow (R-7).
Pricing uses the schedule's exact claim values before holder-specific integer
flooring; flooring can only reduce a claimant's payout, never create an
unbacked upward error.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Iterable, Literal


Exact = int | Fraction
VoidInstrument = Literal["branch_usdc", "leg"]


class PricingRefused(ValueError):
    """A sensitivity whose probability or numeraire is undefined refuses."""


def _exact(name: str, value: Exact) -> Fraction:
    """Convert the supported exact numeric inputs without admitting binary float."""
    if isinstance(value, bool) or not isinstance(value, (int, Fraction)):
        raise PricingRefused(f"{name} must be an int or Fraction, got {type(value).__name__}")
    return Fraction(value)


def _probability(name: str, value: Exact) -> Fraction:
    result = _exact(name, value)
    if not Fraction(0) <= result <= Fraction(1):
        raise PricingRefused(f"{name} {result} outside [0, 1]")
    return result


@dataclass(frozen=True)
class VoidSchedule:
    """D-1's two unpaired claim values and claimant-against flooring."""

    branch_value: Fraction = Fraction(1, 2)
    leg_value: Fraction = Fraction(1, 4)

    def __post_init__(self) -> None:
        branch = _exact("branch_value", self.branch_value)
        leg = _exact("leg_value", self.leg_value)
        if not Fraction(0) < leg <= branch <= Fraction(1):
            raise PricingRefused("VOID values must satisfy 0 < leg <= branch <= 1")
        object.__setattr__(self, "branch_value", branch)
        object.__setattr__(self, "leg_value", leg)

    @property
    def leg_value_in_branch_units(self) -> Fraction:
        """A leg's D-1 redemption value in branch-USDC redemption units."""
        return self.leg_value / self.branch_value

    def payout(self, amount: int, instrument: VoidInstrument) -> int:
        """`redeem_void` gross payout, rounded down against the claimant.

        Amounts are integer USDC base units.  Multiplication by the schedule's
        rational value followed by ``//`` implements `floor(a/2)` and
        `floor(a/4)` exactly.
        """
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
            raise PricingRefused(f"amount must be a non-negative integer, got {amount!r}")
        if instrument == "branch_usdc":
            value = self.branch_value
        elif instrument == "leg":
            value = self.leg_value
        else:
            raise PricingRefused(f"unknown VOID instrument {instrument!r}")
        return amount * value.numerator // value.denominator


# 00 D-1 / 03 §6.4: branch-USDC pays 1/2; scalar and gate legs pay 1/4.
D1_SCHEDULE = VoidSchedule()

# 05 §7(5)-(6): Baseline is settled, independently, at neutral `s = 0.5`.
BASELINE_NEUTRAL_SCORE = Fraction(1, 2)


@dataclass(frozen=True)
class RiskNeutralQuoteScenario:
    """Non-normative inputs for the expected-value quote sensitivity.

    The boolean has no default because D-1 does not supply the convergence
    premise. A false value records that the sensitivity is inapplicable; price
    readouts refuse instead of silently promoting the premise to specification.
    """

    void_probability: Fraction
    quotes_converge_to_expected_value_ratio: bool

    def __post_init__(self) -> None:
        probability = _probability("void_probability", self.void_probability)
        if not isinstance(self.quotes_converge_to_expected_value_ratio, bool):
            raise PricingRefused("quote-convergence premise must be boolean")
        object.__setattr__(self, "void_probability", probability)

# 13 §1 registry defaults consumed by 05 §5 and 04 §12.
DEC_DELTA_TRS = Fraction(3, 80)  # `dec.delta.trs` = 0.0375.
DEC_SIGMA_TRS = Fraction(1, 200)  # `dec.sigma.trs` = 0.005.
GATE_P_MAX = Fraction(1, 20)  # `gate.p_max` = 0.05.
GATE_EPS = Fraction(1, 50)  # `gate.eps` = 0.02.

# 04 §12's published book values.  They are observations in the document; the
# sensitivity functions treat them as the non-VOID values to which VOID risk is
# added, which is the hypothesis this deliverable is required to execute.
EXAMPLE_FULL_ACCEPT = Fraction(562, 1_000)
EXAMPLE_FULL_REJECT = Fraction(521, 1_000)
EXAMPLE_TRAILING_ACCEPT = Fraction(562, 1_000)
EXAMPLE_TRAILING_REJECT = Fraction(5_222, 10_000)
EXAMPLE_BASELINE = Fraction(523, 1_000)
EXAMPLE_GATE_SURVIVAL = (Fraction(11, 1_000), Fraction(9, 1_000))
EXAMPLE_GATE_SECURITY = (Fraction(17, 1_000), Fraction(15, 1_000))


def _require_convergence(scenario: RiskNeutralQuoteScenario) -> Fraction:
    if not scenario.quotes_converge_to_expected_value_ratio:
        raise PricingRefused(
            "risk-neutral quote sensitivity requires the explicit convergence premise"
        )
    return scenario.void_probability


def _require_convergence_flag(
    quotes_converge_to_expected_value_ratio: bool,
) -> None:
    if quotes_converge_to_expected_value_ratio is not True:
        raise PricingRefused(
            "quote-boundary sensitivity requires the explicit convergence premise"
        )


def branch_information_weight(
    scenario: RiskNeutralQuoteScenario, w: Exact
) -> Fraction:
    """Non-normative realized-branch share of the expected numeraire.

    The branch-USDC's expected USDC value is
    `(1-pi)·w + pi·D1.branch_value`.  This function returns the first term's
    share under the scenario's convergence premise. This equation is a
    sensitivity assumption, not a consequence stated by D-1.
    """
    void_probability = _require_convergence(scenario)
    branch_weight = _probability("w", w)
    realized = (1 - void_probability) * branch_weight
    denominator = realized + void_probability * D1_SCHEDULE.branch_value
    if denominator == 0:
        raise PricingRefused(
            "branch-USDC has zero value when pi = 0 and w = 0; its book price is undefined"
        )
    return realized / denominator


def leg_price(
    q: Exact, scenario: RiskNeutralQuoteScenario, w: Exact
) -> Fraction:
    """Non-normative risk-neutral leg quote in branch-USDC.

    `q` is the leg's payoff probability conditional on this branch realizing
    and no VOID. The scenario supplies `pi` and the otherwise-unstated quote
    convergence premise. `w` is the scenario's branch realization probability
    conditional on no VOID.

    The USDC-valued numerator and numeraire are derived independently:

    * leg: `(1-pi)·w·q + pi·(1/4)`;
    * branch-USDC: `(1-pi)·w + pi·(1/2)`.

    Their quotient is the hypothetical quote **only if** the named convergence
    premise holds. D-1 supplies the two VOID payout terms but not this equation.
    """
    conditional_value = _probability("q", q)
    void_probability = _require_convergence(scenario)
    branch_weight = _probability("w", w)
    non_void_branch = (1 - void_probability) * branch_weight
    leg_usdc = non_void_branch * conditional_value + void_probability * D1_SCHEDULE.leg_value
    branch_usdc = non_void_branch + void_probability * D1_SCHEDULE.branch_value
    if branch_usdc == 0:
        raise PricingRefused(
            "branch-USDC has zero value when pi = 0 and w = 0; its book price is undefined"
        )
    return leg_usdc / branch_usdc


def baseline_neutral_price(
    q: Exact, scenario: RiskNeutralQuoteScenario
) -> Fraction:
    """Non-normative Baseline quote sensitivity under neutral settlement.

    Baseline collateral is plain USDC, so there is no branch-USDC denominator:
    `(1-pi)·q + pi·0.5`.  Numerically this happens to equal an equal-weight
    proposal-leg sensitivity under D-1, but the equality disappears for
    `w != 1/2` and the mechanisms must not be conflated.
    """
    conditional_value = _probability("q", q)
    void_probability = _require_convergence(scenario)
    return (1 - void_probability) * conditional_value + void_probability * BASELINE_NEUTRAL_SCORE


def degenerate_branch_price(scenario: RiskNeutralQuoteScenario) -> Fraction:
    """Sensitivity quote when a branch has zero non-VOID realization weight.

    Any positive VOID probability leaves only D-1's quarter-value leg and
    half-value branch-USDC, hence exactly one half independent of `q`.
    """
    void_probability = _require_convergence(scenario)
    if void_probability == 0:
        raise PricingRefused("the w = 0 book has no numeraire when pi = 0")
    return D1_SCHEDULE.leg_value_in_branch_units


def veto_breach_ratio(
    q: Exact,
    p_max: Exact = GATE_P_MAX,
    *,
    quotes_converge_to_expected_value_ratio: bool,
) -> Fraction | None:
    """VOID-to-realized-branch mass at the absolute-veto equality boundary.

    Let `r = pi / ((1-pi)·w)`.  Dividing :func:`leg_price` by the realized
    branch mass gives `(q + r·1/4) / (1 + r·1/2)`.  This function derives the
    `r` at which that price equals `p_max`.  The veto itself is strict (`>`),
    so equality is still clear and every larger ratio breaches.

    Returns zero when the non-VOID value is already at or above the boundary,
    and ``None`` when the D-1 target cannot cross `p_max` from below.
    """
    _require_convergence_flag(quotes_converge_to_expected_value_ratio)
    conditional_value = _probability("q", q)
    cap = _probability("p_max", p_max)
    if conditional_value >= cap:
        return Fraction(0)
    if D1_SCHEDULE.leg_value_in_branch_units <= cap:
        return None
    coefficient = D1_SCHEDULE.leg_value - cap * D1_SCHEDULE.branch_value
    if coefficient <= 0:
        return None
    return (cap - conditional_value) / coefficient


def void_probability_from_ratio(ratio: Exact, w: Exact) -> Fraction:
    """Solve `r = pi / ((1-pi)·w)` for `pi`."""
    r = _exact("ratio", ratio)
    if r < 0:
        raise PricingRefused(f"ratio {r} below zero")
    branch_weight = _probability("w", w)
    if branch_weight == 0:
        raise PricingRefused("a finite contamination ratio is undefined at w = 0")
    return r * branch_weight / (1 + r * branch_weight)


def symmetric_hurdle_boundary(
    q_accept: Exact,
    q_reject: Exact,
    delta: Exact,
    *,
    quotes_converge_to_expected_value_ratio: bool,
) -> Fraction | None:
    """VOID probability at hurdle equality when both branch weights are 1/2.

    Both prices have the same denominator and VOID offset, so their difference
    is the true uplift times one common information weight.  Returns ``None``
    if the non-VOID pair does not initially pass the hurdle.
    """
    _require_convergence_flag(quotes_converge_to_expected_value_ratio)
    accept = _probability("q_accept", q_accept)
    reject = _probability("q_reject", q_reject)
    hurdle = _exact("delta", delta)
    if hurdle <= 0:
        raise PricingRefused(f"delta {hurdle} must be positive")
    uplift = accept - reject
    if uplift < hurdle:
        return None
    target_information_weight = hurdle / uplift
    equal_branch_weight = Fraction(1, 2)
    numerator = (1 - target_information_weight) * equal_branch_weight
    denominator = numerator + target_information_weight * D1_SCHEDULE.branch_value
    return numerator / denominator


@dataclass(frozen=True)
class WorkedExampleBoundaries:
    """04 §12's independently derived VOID sensitivity boundaries."""

    trailing_hurdle: Fraction
    security_gate: Fraction
    survival_gate: Fraction
    full_hurdle: Fraction

    @property
    def first_documented_failure(self) -> Fraction:
        return min(
            self.trailing_hurdle,
            self.security_gate,
            self.survival_gate,
            self.full_hurdle,
        )


def worked_example_boundaries(
    *, quotes_converge_to_expected_value_ratio: bool
) -> WorkedExampleBoundaries:
    """Re-derive all published 04 §12 boundaries under equal branch weights."""
    _require_convergence_flag(quotes_converge_to_expected_value_ratio)
    full = symmetric_hurdle_boundary(
        EXAMPLE_FULL_ACCEPT,
        EXAMPLE_FULL_REJECT,
        DEC_DELTA_TRS,
        quotes_converge_to_expected_value_ratio=True,
    )
    trailing = symmetric_hurdle_boundary(
        EXAMPLE_TRAILING_ACCEPT,
        EXAMPLE_TRAILING_REJECT,
        DEC_DELTA_TRS,
        quotes_converge_to_expected_value_ratio=True,
    )
    survival_ratio = veto_breach_ratio(
        EXAMPLE_GATE_SURVIVAL[0],
        GATE_P_MAX,
        quotes_converge_to_expected_value_ratio=True,
    )
    security_ratio = veto_breach_ratio(
        EXAMPLE_GATE_SECURITY[0],
        GATE_P_MAX,
        quotes_converge_to_expected_value_ratio=True,
    )
    if full is None or trailing is None or survival_ratio is None or security_ratio is None:
        raise PricingRefused("04 §12's published passing example has no equality boundary")
    return WorkedExampleBoundaries(
        trailing_hurdle=trailing,
        security_gate=void_probability_from_ratio(security_ratio, Fraction(1, 2)),
        survival_gate=void_probability_from_ratio(survival_ratio, Fraction(1, 2)),
        full_hurdle=full,
    )


@dataclass(frozen=True)
class GateConditionalValues:
    """One gate's true conditional YES values for ACCEPT and REJECT."""

    name: str
    accept: Fraction
    reject: Fraction


@dataclass(frozen=True)
class PricingInputs:
    """Inputs to a non-normative sensitivity of 05 §5's raw-TWAP rule.

    Tail values are taken equal to full-window values for the asymmetric
    witness.  Book validity, convergence, security sizing and non-price holds
    are outside this arithmetic; the result answers whether the prices read by
    steps 3-7 say ADOPT after all price vetoes and floors are applied.
    """

    decision_accept: Fraction
    decision_reject: Fraction
    baseline: Fraction
    scenario: RiskNeutralQuoteScenario
    gates: tuple[GateConditionalValues, ...]
    delta: Fraction = DEC_DELTA_TRS
    sigma: Fraction = DEC_SIGMA_TRS
    p_max: Fraction = GATE_P_MAX
    epsilon: Fraction = GATE_EPS


@dataclass(frozen=True)
class GateReadout:
    values: GateConditionalValues
    accept_price: Fraction
    reject_price: Fraction


@dataclass(frozen=True)
class PricingReadout:
    """Conditional and sensitivity readings at one complementary weight pair."""

    inputs: PricingInputs
    w_accept: Fraction
    w_reject: Fraction
    accept_price: Fraction
    reject_price: Fraction
    baseline_price: Fraction
    gates: tuple[GateReadout, ...]

    @property
    def true_reject_floor(self) -> Fraction:
        return max(self.inputs.decision_reject, self.inputs.baseline - self.inputs.sigma)

    @property
    def priced_reject_floor(self) -> Fraction:
        return max(self.reject_price, self.baseline_price - self.inputs.sigma)

    @property
    def true_uplift(self) -> Fraction:
        return self.inputs.decision_accept - self.true_reject_floor

    @property
    def priced_uplift(self) -> Fraction:
        return self.accept_price - self.priced_reject_floor

    @property
    def true_gates_clear(self) -> bool:
        return all(
            gate.accept <= self.inputs.p_max
            and gate.accept <= gate.reject + self.inputs.epsilon
            for gate in self.inputs.gates
        )

    @property
    def priced_gates_clear(self) -> bool:
        return all(
            gate.accept_price <= self.inputs.p_max
            and gate.accept_price <= gate.reject_price + self.inputs.epsilon
            for gate in self.gates
        )

    @property
    def true_hurdle_pass(self) -> bool:
        return self.true_uplift >= self.inputs.delta

    @property
    def priced_hurdle_pass(self) -> bool:
        return self.priced_uplift >= self.inputs.delta

    @property
    def true_pricing_adopt(self) -> bool:
        return self.true_gates_clear and self.true_hurdle_pass

    @property
    def priced_pricing_adopt(self) -> bool:
        return self.priced_gates_clear and self.priced_hurdle_pass

    @property
    def false_adopt(self) -> bool:
        return not self.true_pricing_adopt and self.priced_pricing_adopt


def price_readout(inputs: PricingInputs, w_accept: Exact) -> PricingReadout:
    """Run the quote sensitivity with complementary branch weights."""
    accept_weight = _probability("w_accept", w_accept)
    reject_weight = 1 - accept_weight
    _require_convergence(inputs.scenario)
    decision_accept = _probability("decision_accept", inputs.decision_accept)
    decision_reject = _probability("decision_reject", inputs.decision_reject)
    baseline = _probability("baseline", inputs.baseline)
    delta = _exact("delta", inputs.delta)
    sigma = _exact("sigma", inputs.sigma)
    p_max = _probability("p_max", inputs.p_max)
    epsilon = _exact("epsilon", inputs.epsilon)
    if delta <= 0 or sigma < 0 or epsilon < 0:
        raise PricingRefused("delta must be positive; sigma and epsilon must be non-negative")

    gate_readouts: list[GateReadout] = []
    for gate in inputs.gates:
        gate_accept = _probability(f"{gate.name}.accept", gate.accept)
        gate_reject = _probability(f"{gate.name}.reject", gate.reject)
        gate_readouts.append(
            GateReadout(
                gate,
                leg_price(gate_accept, inputs.scenario, accept_weight),
                leg_price(gate_reject, inputs.scenario, reject_weight),
            )
        )

    # Keep the normalized exact values in the returned input bundle so every
    # property below is evaluated on the same representation.
    normalized = PricingInputs(
        decision_accept=decision_accept,
        decision_reject=decision_reject,
        baseline=baseline,
        scenario=inputs.scenario,
        gates=tuple(
            GateConditionalValues(
                gate.name,
                _probability(f"{gate.name}.accept", gate.accept),
                _probability(f"{gate.name}.reject", gate.reject),
            )
            for gate in inputs.gates
        ),
        delta=delta,
        sigma=sigma,
        p_max=p_max,
        epsilon=epsilon,
    )
    return PricingReadout(
        inputs=normalized,
        w_accept=accept_weight,
        w_reject=reject_weight,
        accept_price=leg_price(decision_accept, inputs.scenario, accept_weight),
        reject_price=leg_price(decision_reject, inputs.scenario, reject_weight),
        baseline_price=baseline_neutral_price(baseline, inputs.scenario),
        gates=tuple(gate_readouts),
    )


def search_false_adopt(
    inputs: PricingInputs, accept_weights: Iterable[Exact]
) -> PricingReadout | None:
    """Return the first exact complementary weight pair producing a false ADOPT.

    Candidate weights are normalized, de-duplicated and sorted, so iteration is
    stable even when the caller supplies a set or a descending sequence.
    """
    weights = sorted({_probability("w_accept", weight) for weight in accept_weights})
    for weight in weights:
        readout = price_readout(inputs, weight)
        if readout.false_adopt:
            return readout
    return None


@dataclass(frozen=True)
class FalseAdoptInterval:
    """Exact rational brackets around the continuous false-ADOPT interval.

    `gate_fails_below < gate_clears_from` brackets the entry boundary;
    `hurdle_passes_through < hurdle_fails_above` brackets the exit boundary.
    The inner two weights are confirmed false-ADOPT witnesses.
    """

    gate_fails_below: Fraction
    gate_clears_from: Fraction
    hurdle_passes_through: Fraction
    hurdle_fails_above: Fraction

    @property
    def entry_width(self) -> Fraction:
        return self.gate_clears_from - self.gate_fails_below

    @property
    def exit_width(self) -> Fraction:
        return self.hurdle_fails_above - self.hurdle_passes_through


def search_false_adopt_interval(
    inputs: PricingInputs, iterations: int = 100
) -> FalseAdoptInterval | None:
    """Bracket the complete continuous false-ADOPT interval on `w_acc ∈ [0, 1/2]`.

    This is stronger than a sample search, but its monotonic proof has an
    explicit domain.  When every conditional leg value is at or below one
    half, increasing `w_accept` moves ACCEPT prices down and REJECT prices up:

    * the absolute/relative gate predicates can change only from veto to clear;
    * the welfare hurdle can change only from pass to fail.

    Exact Fraction bisection therefore brackets the only possible entry and
    exit boundaries.  Inputs outside that monotone domain refuse rather than
    borrowing the proof.  ``None`` means the two intervals do not overlap or
    the uncontaminated inputs were not a true REJECT.
    """
    if isinstance(iterations, bool) or not isinstance(iterations, int) or iterations < 1:
        raise PricingRefused(f"iterations must be a positive integer, got {iterations!r}")
    pi = _require_convergence(inputs.scenario)
    if pi == 0:
        raise PricingRefused("continuous search at w_accept = 0 requires pi > 0")
    monotone_values = (
        _probability("decision_accept", inputs.decision_accept),
        _probability("decision_reject", inputs.decision_reject),
        *(
            value
            for gate in inputs.gates
            for value in (
                _probability(f"{gate.name}.accept", gate.accept),
                _probability(f"{gate.name}.reject", gate.reject),
            )
        ),
    )
    if any(value > Fraction(1, 2) for value in monotone_values):
        raise PricingRefused("continuous boundary proof requires every proposal leg q <= 1/2")

    zero = price_readout(inputs, Fraction(0))
    half = price_readout(inputs, Fraction(1, 2))
    if zero.true_pricing_adopt or half.true_pricing_adopt:
        return None
    if zero.priced_gates_clear or not half.priced_gates_clear:
        return None  # no veto→clear boundary on the searched half-space.
    if not zero.priced_hurdle_pass or half.priced_hurdle_pass:
        return None  # no pass→fail boundary on the searched half-space.

    gate_fail, gate_clear = Fraction(0), Fraction(1, 2)
    for _ in range(iterations):
        midpoint = (gate_fail + gate_clear) / 2
        if price_readout(inputs, midpoint).priced_gates_clear:
            gate_clear = midpoint
        else:
            gate_fail = midpoint

    hurdle_pass, hurdle_fail = Fraction(0), Fraction(1, 2)
    for _ in range(iterations):
        midpoint = (hurdle_pass + hurdle_fail) / 2
        if price_readout(inputs, midpoint).priced_hurdle_pass:
            hurdle_pass = midpoint
        else:
            hurdle_fail = midpoint

    if gate_clear > hurdle_pass:
        return None
    if not price_readout(inputs, gate_clear).false_adopt:
        return None
    if not price_readout(inputs, hurdle_pass).false_adopt:
        return None
    return FalseAdoptInterval(
        gate_fails_below=gate_fail,
        gate_clears_from=gate_clear,
        hurdle_passes_through=hurdle_pass,
        hurdle_fails_above=hurdle_fail,
    )


@dataclass(frozen=True)
class PricingFinding:
    """A queryable document observation or conditional sensitivity."""

    key: str
    ok: bool
    detail: str
    witness: PricingReadout | None = None


def check_weight_safety(
    inputs: PricingInputs, accept_weights: Iterable[Exact]
) -> tuple[PricingFinding, ...]:
    """Report SQ-559 without treating a pricing hypothesis as a defect.

    Every returned finding is ``ok=True``. The first records the supported
    document observation. The second either reports that the sensitivity was
    not run because its convergence premise is absent, or reports the exact
    hypothetical result conditional on that premise.
    """
    if not inputs.scenario.quotes_converge_to_expected_value_ratio:
        return (
            PricingFinding(
                key="decision rule reads raw TWAP without a VOID-adjusted series",
                ok=True,
                detail="05 §5 consumes raw TWAPs; no document adopts a VOID-adjusted series",
            ),
            PricingFinding(
                key="risk-neutral VOID sensitivity",
                ok=True,
                detail=(
                    "not evaluated: scenario does not assume quotes converge "
                    "to expected payout over expected branch-USDC value"
                ),
            ),
        )
    symmetric = price_readout(inputs, Fraction(1, 2))
    witness = search_false_adopt(inputs, accept_weights)
    return (
        PricingFinding(
            key="decision rule reads raw TWAP without a VOID-adjusted series",
            ok=True,
            detail=(
                "05 §5 consumes raw TWAPs; no document adopts a VOID-adjusted series; "
                f"equal-weight sensitivity false_adopt={symmetric.false_adopt}"
            ),
        ),
        PricingFinding(
            key="risk-neutral VOID sensitivity",
            ok=True,
            detail=(
                "no hypothetical false ADOPT in supplied exact weight space"
                if witness is None
                else (
                    "conditional on risk-neutral quote convergence: "
                    f"w_accept={witness.w_accept}, w_reject={witness.w_reject}, "
                    f"true uplift={witness.true_uplift}, priced uplift={witness.priced_uplift}"
                )
            ),
            witness=witness,
        ),
    )


def degenerate_reject_probability_boundary(
    pi: Exact,
    delta: Exact,
    *,
    quotes_converge_to_expected_value_ratio: bool,
) -> Fraction:
    """Reject-leg `q` at hurdle equality as `w_accept -> 0`, `w_reject -> 1`.

    The ACCEPT price is D-1's one-half target, independent of its truth.  This
    solves `1/2 - price(q_reject, pi, 1) = delta`.  Values below the returned
    boundary create a contaminated hurdle pass in the degenerate limit when
    the Baseline floor is non-binding; values above do not.  This is a welfare
    boundary, not a claim that the gate vetoes also clear at `w_accept = 0` —
    they do not, which is why :func:`search_false_adopt` checks them explicitly.
    """
    _require_convergence_flag(quotes_converge_to_expected_value_ratio)
    void_probability = _probability("pi", pi)
    hurdle = _exact("delta", delta)
    if not Fraction(0) < void_probability < Fraction(1):
        raise PricingRefused("degenerate boundary requires 0 < pi < 1")
    if hurdle <= 0:
        raise PricingRefused(f"delta {hurdle} must be positive")
    target = D1_SCHEDULE.leg_value_in_branch_units
    non_void = 1 - void_probability
    reject_numeraire = non_void + void_probability * D1_SCHEDULE.branch_value
    return (
        (target - hurdle) * reject_numeraire
        - void_probability * D1_SCHEDULE.leg_value
    ) / non_void
