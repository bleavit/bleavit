from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
class Outcome(Enum): ADOPT="Adopt"; EXTEND="Extend"; REJECT="Reject"
class RejectReason(Enum): NOT_DECISION_GRADE="NotDecisionGrade"; HURDLE_NOT_MET="HurdleNotMet"; CONVERGENCE_FAILED="ConvergenceFailed"; SECOND_EXTENSION_FAILED="SecondExtensionFailed"; SECURITY_SIZING="SecuritySizing"; GATE_VETO_SURVIVAL="GateVetoSurvival"; GATE_VETO_SECURITY="GateVetoSecurity"
@dataclass(frozen=True)
class Decision: outcome: Outcome; reason: RejectReason | None = None

def decide(delta: Decimal, hurdle: Decimal, converged: bool=True, grade: bool=True, extended: bool=False, security_ok: bool=True, survival_gate: bool=False, security_gate: bool=False) -> Decision:
    if not grade: return Decision(Outcome.REJECT, RejectReason.NOT_DECISION_GRADE)
    if survival_gate: return Decision(Outcome.REJECT, RejectReason.GATE_VETO_SURVIVAL)
    if security_gate: return Decision(Outcome.REJECT, RejectReason.GATE_VETO_SECURITY)
    if not converged: return Decision(Outcome.REJECT if extended else Outcome.EXTEND, RejectReason.SECOND_EXTENSION_FAILED if extended else RejectReason.CONVERGENCE_FAILED)
    if Decimal(delta) < Decimal(hurdle): return Decision(Outcome.REJECT, RejectReason.HURDLE_NOT_MET)
    if not security_ok: return Decision(Outcome.REJECT, RejectReason.SECURITY_SIZING)
    return Decision(Outcome.ADOPT)
