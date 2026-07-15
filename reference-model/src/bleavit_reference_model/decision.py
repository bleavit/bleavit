from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Mapping

from .treasury import attack_cost_hat, in_cap_prize, security_sizing_ok


class Outcome(Enum):
    ADOPT = "Adopt"
    EXTEND = "Extend"
    REJECT = "Reject"


class RejectReason(Enum):
    NOT_DECISION_GRADE = "NotDecisionGrade"
    GATE_VETO_SURVIVAL = "GateVetoSurvival"
    GATE_VETO_SECURITY = "GateVetoSecurity"
    HURDLE_NOT_MET = "HurdleNotMet"
    CONVERGENCE_FAILED = "ConvergenceFailed"
    SECOND_EXTENSION_FAILED = "SecondExtensionFailed"
    PROCESS_HOLD = "ProcessHold"
    CONSTITUTION_VIOLATION = "ConstitutionViolation"
    RESOURCE_CONFLICT = "ResourceConflict"
    RATE_LIMITED = "RateLimited"
    VETO_UPHELD_BY_REVIEW = "VetoUpheldByReview"  # Guardian review producer, T24.
    STALE_QUEUE = "StaleQueue"  # Execution-guard producer, T16.
    PAYLOAD_REVERTED = "PayloadReverted"  # Execution recording, T18/T22.
    NOT_RATIFIED = "NotRatified"  # Execution-guard producer, T16.
    SECURITY_SIZING = "SecuritySizing"
    ATTESTATION_MISSING = "AttestationMissing"


class Grade(Enum):
    OK = "Ok"
    INSUFFICIENT = "Insufficient"
    INVALID = "Invalid"


class Gate(Enum):
    SURVIVAL = "Survival"
    SECURITY = "Security"


class ProposalClass(Enum):
    PARAM = "Param"
    TREASURY = "Treasury"
    CODE = "Code"
    META = "Meta"


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    reason: RejectReason | None = None


DEFAULT_P_MAX = Decimal("0.05")  # 13 §1 gate.p_max.
DEFAULT_EPS = Decimal("0.02")  # 13 §1 gate.eps.


def _decimal_map(
    values: Mapping[Gate | str, Decimal] | None, default: Decimal
) -> dict[Gate, Decimal]:
    result = {gate: default for gate in Gate}
    if values is None:
        return result
    for gate in Gate:
        for key in (gate, gate.value, gate.name, gate.name.lower()):
            if key in values:
                result[gate] = Decimal(values[key])
                break
    return result


def _grade(value: Grade | str) -> Grade:
    if isinstance(value, Grade):
        return value
    for grade in Grade:
        if value in (grade.value, grade.name, grade.name.lower()):
            return grade
    raise ValueError("unknown grade")


def _proposal_class(value: ProposalClass | str) -> ProposalClass:
    if isinstance(value, ProposalClass):
        return value
    for proposal_class in ProposalClass:
        if value in (
            proposal_class.value,
            proposal_class.name,
            proposal_class.name.lower(),
        ):
            return proposal_class
    raise ValueError("unknown proposal class")


def decide(
    accept_full: Decimal,
    reject_full_effective: Decimal,
    delta: Decimal,
    accept_trailing: Decimal | None = None,
    reject_trailing_effective: Decimal | None = None,
    converged: bool = True,
    extended: bool = False,
    preimage_ok: bool = True,
    resource_locks_held: bool = True,
    process_hold: bool = False,
    requires_gate_markets: bool = False,
    gate_book_valid: bool = True,
    p_adopt: Mapping[Gate | str, Decimal] | None = None,
    p_reject: Mapping[Gate | str, Decimal] | None = None,
    p_max: Mapping[Gate | str, Decimal] | None = None,
    eps: Mapping[Gate | str, Decimal] | None = None,
    welfare_grade: Grade | str = Grade.OK,
    grade: bool | None = None,
    proposal_class: ProposalClass | str = ProposalClass.PARAM,
    ask: Decimal = Decimal(0),
    envelope_value: Decimal = Decimal(0),
    spendable_nav: Decimal = Decimal(0),
    measured_liquidity: Decimal = Decimal(0),
    published_flow_per_day: Decimal | None = None,
    decision_window: int = 43_200,
    attestation_ok: bool = True,
    queue_time_ok: bool = True,
) -> Decision:
    """The ordered 11-step decision rule of 05 §5.4.

    `grade` is a compatibility alias for the former welfare-only boolean; gate
    validity remains a separate step and is never inferred from it.
    """
    a_f = Decimal(accept_full)
    r_f = Decimal(reject_full_effective)
    d = Decimal(delta)
    a_t = a_f if accept_trailing is None else Decimal(accept_trailing)
    r_t = (
        r_f
        if reject_trailing_effective is None
        else Decimal(reject_trailing_effective)
    )
    proposal_class = _proposal_class(proposal_class)
    if grade is not None:
        welfare_grade = Grade.OK if grade else Grade.INVALID
    welfare_grade = _grade(welfare_grade)

    # Step 1: payload/preimage, then resource locks.
    if not preimage_ok:
        return Decision(Outcome.REJECT, RejectReason.CONSTITUTION_VIOLATION)
    if not resource_locks_held:
        return Decision(Outcome.REJECT, RejectReason.RESOURCE_CONFLICT)

    # Step 2: disputes, guardian hold, and dead-man state.
    if process_hold:
        return Decision(Outcome.REJECT, RejectReason.PROCESS_HOLD)

    # Steps 3-4 apply only to gate-bearing classes.
    if requires_gate_markets:
        if not gate_book_valid:
            return Decision(Outcome.REJECT, RejectReason.NOT_DECISION_GRADE)
        adopt = _decimal_map(p_adopt, Decimal(0))
        reject = _decimal_map(p_reject, Decimal(0))
        maxima = _decimal_map(p_max, DEFAULT_P_MAX)
        margins = _decimal_map(eps, DEFAULT_EPS)
        for gate in (Gate.SURVIVAL, Gate.SECURITY):
            if (
                adopt[gate] > maxima[gate]
                or adopt[gate] > reject[gate] + margins[gate]
            ):
                reason = (
                    RejectReason.GATE_VETO_SURVIVAL
                    if gate is Gate.SURVIVAL
                    else RejectReason.GATE_VETO_SECURITY
                )
                return Decision(Outcome.REJECT, reason)

    # Step 5: welfare grade, with one shared extension budget.
    if welfare_grade is Grade.INSUFFICIENT and not extended:
        return Decision(Outcome.EXTEND)
    if welfare_grade is not Grade.OK:
        return Decision(Outcome.REJECT, RejectReason.NOT_DECISION_GRADE)

    # Steps 6-8: full/trailing hurdle and convergence match.
    full_pass = a_f >= r_f + d
    tail_pass = a_t >= r_t + d
    if not (full_pass and tail_pass and converged):
        if full_pass != tail_pass:
            if extended:
                return Decision(
                    Outcome.REJECT, RejectReason.SECOND_EXTENSION_FAILED
                )
            return Decision(Outcome.EXTEND)
        reason = (
            RejectReason.HURDLE_NOT_MET
            if converged
            else RejectReason.CONVERGENCE_FAILED
        )
        return Decision(Outcome.REJECT, reason)

    # Step 9: 3·InCapPrize <= AttackCost-hat, with treasury rounding.
    prize = in_cap_prize(
        proposal_class,
        ask=ask,
        envelope=envelope_value,
        spendable_nav=spendable_nav,
    )
    attack_cost = attack_cost_hat(
        measured_liquidity,
        published_flow_per_day=published_flow_per_day,
        decision_window=decision_window,
    )
    if not security_sizing_ok(prize, attack_cost):
        return Decision(Outcome.REJECT, RejectReason.SECURITY_SIZING)

    # Step 10: attestation precedes constitutional meters/spacing.
    if proposal_class in (ProposalClass.CODE, ProposalClass.META):
        if not attestation_ok:
            return Decision(Outcome.REJECT, RejectReason.ATTESTATION_MISSING)
    if not queue_time_ok:
        return Decision(Outcome.REJECT, RejectReason.RATE_LIMITED)

    # Step 11.
    return Decision(Outcome.ADOPT)
