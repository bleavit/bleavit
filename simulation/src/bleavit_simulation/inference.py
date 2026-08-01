"""15 §4.9 and 09 §7.1 — confidence bounds on Phase-0 false-pass rates.

The documents require each class's decidable-harm false-pass rate to be
strictly below 1 %, independently, and the committed calibration artifact
publishes the four point estimates that feed that claim. Neither document
states a confidence level, an interval, or a minimum per-class denominator.

Executing the exact one-sided Clopper-Pearson construction at 95 % shows that
the point estimates alone do not establish the published inequality for every
class: PARAM 0/168 has upper bound 0.0176736950..., and META 4/711 has upper
bound 0.0128275455.... TREASURY 1/688 (0.0068764197...) and CODE 1/742
(0.0063772417...) clear 0.01. Conditional on the observed rates not worsening,
the first adverse-rounded denominators that clear are 299, 473, 473 and 1,568
respectively; no owning document states those sampling figures.

The same artifact also falsifies its per-class status
``no_causal_wrong_pass_observed``. It records 62 causal wrong-PASS candidates,
all dispositioned under 15 §4.9's realized-cost rule as unprofitable griefing;
zero profitable brackets is not zero causal observations.

Units are probabilities as exact fractions of one. Binomial probabilities and
the bisection decisions are exact :class:`fractions.Fraction` arithmetic. The
reported Decimal is the upper endpoint of a bracket no wider than 1e-24 and is
converted with 80-digit precision toward one. For sample-size planning,
``observed_rate * n`` is rounded up to an event count: rounding down would
discard evidence in the claimant's favour. These confidence findings are
diagnostic evidence for SQ-550, not a new normative publication gate.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, localcontext
from fractions import Fraction
import json
from math import comb
from pathlib import Path


# 15 §4.9 / 09 §7.1: the point-rate gate is strict and per class.
FALSE_PASS_GATE = Fraction(1, 100)
# SQ-550's diagnostic convention. The owning documents do not state a level.
ONE_SIDED_ALPHA = Fraction(1, 20)

DECIMAL_PRECISION = 80
BOUND_TOLERANCE = Fraction(1, 10**24)
MAX_BISECTION_STEPS = 256

CLASS_ORDER = ("param", "treasury", "code", "meta")
COMMITTED_ARTIFACT = (
    Path(__file__).resolve().parents[2] / "results" / "phase0-calibration.json"
)

RationalInput = int | str | Decimal | Fraction


class InferenceError(ValueError):
    """An interval or artifact that cannot be interpreted refuses."""


def _as_fraction(value: RationalInput, label: str) -> Fraction:
    """Convert a rational input without admitting binary-float ambiguity."""
    if isinstance(value, bool) or isinstance(value, float):
        raise InferenceError(f"{label} must be an exact rational value")
    try:
        return Fraction(value)
    except (OverflowError, TypeError, ValueError, ZeroDivisionError) as error:
        raise InferenceError(f"{label} must be an exact rational value") from error


def _count(value: object, label: str, *, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        qualifier = "positive" if positive else "non-negative"
        raise InferenceError(f"{label} must be a {qualifier} integer")
    return value


def _binomial_cdf(k: int, n: int, probability: Fraction) -> Fraction:
    """Exact ``P[X <= k]`` for ``X ~ Binomial(n, probability)``.

    Every term is placed over the common integer denominator ``b**n`` for
    ``probability = a/b``. That avoids a Decimal tail deciding which side of
    ``alpha`` a bisection midpoint occupies.
    """
    successes = probability.numerator
    denominator = probability.denominator
    failures = denominator - successes
    numerator = sum(
        comb(n, index)
        * successes**index
        * failures ** (n - index)
        for index in range(k + 1)
    )
    return Fraction(numerator, denominator**n)


def _decimal_ceiling(value: Fraction) -> Decimal:
    """Render a non-negative fraction at fixed precision, toward one."""
    with localcontext() as context:
        context.prec = DECIMAL_PRECISION
        context.rounding = ROUND_CEILING
        return Decimal(value.numerator) / Decimal(value.denominator)


def upper_bound(
    k: int,
    n: int,
    alpha: RationalInput = ONE_SIDED_ALPHA,
) -> Decimal:
    """Exact one-sided Clopper-Pearson upper bound for ``k`` events in ``n``.

    For ``k < n``, this inverts the binomial-tail identity

    ``P_p[X <= k] = alpha``.

    The CDF is strictly decreasing in ``p``. Bisection therefore retains the
    root in ``[low, high]`` and returns ``high`` after proving that the bracket
    is no wider than :data:`BOUND_TOLERANCE`. Returning the upper endpoint is
    the against-the-claimant direction: numerical error cannot make a
    false-pass upper bound look smaller.
    """
    failures = _count(k, "k")
    trials = _count(n, "n", positive=True)
    if failures > trials:
        raise InferenceError(f"k={failures} exceeds n={trials}")
    tail = _as_fraction(alpha, "alpha")
    if not Fraction(0) < tail < Fraction(1):
        raise InferenceError("alpha must lie strictly inside (0, 1)")
    if failures == trials:
        return Decimal(1)

    low, high = Fraction(0), Fraction(1)
    for _ in range(MAX_BISECTION_STEPS):
        if high - low <= BOUND_TOLERANCE:
            break
        midpoint = (low + high) / 2
        if _binomial_cdf(failures, trials, midpoint) > tail:
            low = midpoint
        else:
            high = midpoint
    if high - low > BOUND_TOLERANCE:
        raise AssertionError(
            "Clopper-Pearson bisection did not reach the stated tolerance"
        )
    return _decimal_ceiling(high)


def _ceil_fraction(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def required_n(
    alpha: RationalInput,
    gate: RationalInput,
    observed_k_rate: RationalInput,
) -> int:
    """First denominator whose adverse-rounded upper bound is below ``gate``.

    At candidate denominator ``n``, the event count is
    ``ceil(observed_k_rate * n)``. The ceiling makes this a conservative
    planning figure conditional on the observed rate not worsening; it does
    not predict how many future events will occur and it does not amend the
    point-rate criterion in 15 §4.9.

    ``upper_bound(k, n, alpha) < gate`` is equivalent to
    ``P_gate[X <= k] < alpha``. Testing that exact identity avoids running a
    full bisection for every candidate denominator.
    """
    tail = _as_fraction(alpha, "alpha")
    threshold = _as_fraction(gate, "gate")
    rate = _as_fraction(observed_k_rate, "observed_k_rate")
    if not Fraction(0) < tail < Fraction(1):
        raise InferenceError("alpha must lie strictly inside (0, 1)")
    if not Fraction(0) < threshold < Fraction(1):
        raise InferenceError("gate must lie strictly inside (0, 1)")
    if not Fraction(0) <= rate <= Fraction(1):
        raise InferenceError("observed_k_rate must lie inside [0, 1]")
    if rate >= threshold:
        raise InferenceError(
            "an observed rate at or above the gate cannot clear it by sampling"
        )

    trials = 1
    while True:
        failures = _ceil_fraction(rate * trials)
        if _binomial_cdf(failures, trials, threshold) < tail:
            return trials
        trials += 1


@dataclass(frozen=True)
class FalsePassEvidence:
    """One class's integer evidence, read from the committed artifact."""

    proposal_class: str
    false_passes: int
    decidable_harm: int

    @property
    def point_rate(self) -> Fraction:
        return Fraction(self.false_passes, self.decidable_harm)


@dataclass(frozen=True)
class ConfidenceFinding:
    """Whether one artifact class clears a confidence-aware diagnostic."""

    key: str
    ok: bool
    proposal_class: str
    false_passes: int
    decidable_harm: int
    point_rate: Fraction
    upper: Decimal
    gate: Fraction


@dataclass(frozen=True)
class AttackStatusFinding:
    """Whether one per-class attack status agrees with its dispositions."""

    key: str
    ok: bool
    proposal_class: str
    published_status: str
    expected_status: str
    causal_wrong_passes: int
    unprofitable_wrong_passes: int
    profitable_brackets: int
    noncausal_dispositions: int


def _load_artifact(path: str | Path) -> dict:
    artifact_path = Path(path)
    try:
        payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise InferenceError(
            f"cannot read calibration artifact {artifact_path}"
        ) from error
    if not isinstance(payload, dict):
        raise InferenceError("calibration artifact root must be an object")
    return payload


def read_false_pass_evidence(
    path: str | Path = COMMITTED_ARTIFACT,
) -> tuple[FalsePassEvidence, ...]:
    """Read all four per-class numerators and denominators from an artifact."""
    payload = _load_artifact(path)
    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        raise InferenceError("calibration artifact has no metrics object")
    rows = []
    for proposal_class in CLASS_ORDER:
        metric = metrics.get(proposal_class)
        if not isinstance(metric, dict):
            raise InferenceError(f"artifact has no {proposal_class} metric row")
        denominator = _count(
            metric.get("decidable_harm"),
            f"metrics.{proposal_class}.decidable_harm",
            positive=True,
        )
        numerator = _count(
            metric.get("decidable_harm_false_pass_count"),
            f"metrics.{proposal_class}.decidable_harm_false_pass_count",
        )
        if numerator > denominator:
            raise InferenceError(
                f"metrics.{proposal_class} false passes exceed decidable harm"
            )
        rows.append(
            FalsePassEvidence(
                proposal_class=proposal_class,
                false_passes=numerator,
                decidable_harm=denominator,
            )
        )
    return tuple(rows)


def check_confidence(
    path: str | Path = COMMITTED_ARTIFACT,
    *,
    alpha: RationalInput = ONE_SIDED_ALPHA,
    gate: RationalInput = FALSE_PASS_GATE,
) -> tuple[ConfidenceFinding, ...]:
    """Return SQ-550's confidence finding as queryable per-class rows."""
    tail = _as_fraction(alpha, "alpha")
    threshold = _as_fraction(gate, "gate")
    findings = []
    for row in read_false_pass_evidence(path):
        upper = upper_bound(row.false_passes, row.decidable_harm, tail)
        findings.append(
            ConfidenceFinding(
                key=f"{row.proposal_class}.decidable_harm_false_pass_upper",
                # ``upper`` was rounded toward one. Converting that finite
                # Decimal back to an exact fraction keeps the gate comparison
                # conservative even when ``gate`` has a recurring expansion.
                ok=Fraction(upper) < threshold,
                proposal_class=row.proposal_class,
                false_passes=row.false_passes,
                decidable_harm=row.decidable_harm,
                point_rate=row.point_rate,
                upper=upper,
                gate=threshold,
            )
        )
    return tuple(findings)


def check_attack_status(
    path: str | Path = COMMITTED_ARTIFACT,
) -> tuple[AttackStatusFinding, ...]:
    """Check whether attack status labels distinguish absence from disposition.

    A bracket row and a ``direction == 'wrong_pass'`` griefing diagnostic are
    both causal wrong-PASS observations. The former is a profitable candidate;
    the latter can be an observed flip accepted as unprofitable under 15 §4.9.
    Rows explicitly placed in ``noncausal_wrong_pass_dispositions`` are not
    counted as causal.
    """
    payload = _load_artifact(path)
    attack = payload.get("attack_cost_validation")
    if not isinstance(attack, dict):
        raise InferenceError("calibration artifact has no attack validation object")
    per_class = attack.get("per_class")
    brackets = attack.get("brackets")
    diagnostics = attack.get("griefing_cost_diagnostics")
    noncausal = attack.get("noncausal_wrong_pass_dispositions")
    if not isinstance(per_class, dict) or not all(
        isinstance(rows, list) for rows in (brackets, diagnostics, noncausal)
    ):
        raise InferenceError("attack validation disposition rows are incomplete")

    causal = {name: 0 for name in CLASS_ORDER}
    unprofitable = {name: 0 for name in CLASS_ORDER}
    profitable = {name: 0 for name in CLASS_ORDER}
    noncausal_counts = {name: 0 for name in CLASS_ORDER}

    def row_class(row: object, label: str) -> str:
        if not isinstance(row, dict) or row.get("class") not in CLASS_ORDER:
            raise InferenceError(f"{label} has an unknown class")
        return row["class"]

    for index, row in enumerate(brackets):
        proposal_class = row_class(row, f"attack bracket {index}")
        if row.get("direction") != "wrong_pass":
            raise InferenceError(f"attack bracket {index} is not a wrong-PASS row")
        causal[proposal_class] += 1
        profitable[proposal_class] += 1
    for index, row in enumerate(diagnostics):
        if not isinstance(row, dict) or row.get("direction") != "wrong_pass":
            continue
        proposal_class = row_class(row, f"griefing diagnostic {index}")
        causal[proposal_class] += 1
        if row.get("diagnostic") == "unprofitable_griefing_cost_ge_prize":
            unprofitable[proposal_class] += 1
    for index, row in enumerate(noncausal):
        proposal_class = row_class(row, f"noncausal disposition {index}")
        noncausal_counts[proposal_class] += 1

    recorded_candidates = _count(
        attack.get("wrong_pass_candidates"), "attack.wrong_pass_candidates"
    )
    accounted = sum(causal.values()) + sum(noncausal_counts.values())
    if recorded_candidates != accounted:
        raise InferenceError(
            "wrong-PASS candidate count disagrees with causal and noncausal rows"
        )

    findings = []
    for proposal_class in CLASS_ORDER:
        summary = per_class.get(proposal_class)
        if not isinstance(summary, dict) or not isinstance(summary.get("status"), str):
            raise InferenceError(f"attack summary has no {proposal_class} status")
        published = summary["status"]
        if causal[proposal_class] == 0:
            expected = "no_causal_wrong_pass_observed"
        elif (
            profitable[proposal_class] == 0
            and unprofitable[proposal_class] == causal[proposal_class]
        ):
            expected = "all_candidates_unprofitable"
        else:
            expected = "measured"
        findings.append(
            AttackStatusFinding(
                key=f"{proposal_class}.attack_status",
                ok=published == expected,
                proposal_class=proposal_class,
                published_status=published,
                expected_status=expected,
                causal_wrong_passes=causal[proposal_class],
                unprofitable_wrong_passes=unprofitable[proposal_class],
                profitable_brackets=profitable[proposal_class],
                noncausal_dispositions=noncausal_counts[proposal_class],
            )
        )
    return tuple(findings)
