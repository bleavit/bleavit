"""06 §5, §6.3 — guardian bonds, liability depletion and recall latency.

Doc 06 defines a seven-seat, 5-of-7 guardian body whose members each post
50,000 VIT, lose 50% of that seat bond after a failed retrospective review,
and face a values-layer recall. It also says the seven-day guardian-track
decision for a ``PB-LEDGER-FREEZE`` renewal fits inside the first 14-day
activation window. Those statements publish inputs, not their composition.

Executing the composition exposes four facts the document does not state:

* at 13 §1's explicitly unverified 0.05 USDC/VIT launch placeholder, one seat
  is 2,500 USDC, the five-seat approving coalition is 12,500 USDC, and all
  seven seats are 17,500 USDC; across the rate's lawful 0.1x–10x envelope a
  seat spans 250–25,000 USDC;
* the fixed 25,000-VIT slash exhausts a seat after two failed reviews, capping
  its lifetime slash at 2,500 USDC at that placeholder, while §5.1's
  membership-only action gate still admits the zero-bond member. A third
  failure is therefore free if the values layer has declined or failed to
  enact both automatically scheduled recalls;
* the shipped strict epoch-index fallback plus a successful guardian-track
  recall takes at most 74 days at the defaults and 221 days at the lawful
  ``(grd.review_dl, epoch.length)`` maximum: 74/21 and 221/42 obstruction
  cycles. The block-duration deadline the document prefers would instead take
  53 and 179 days respectively;
* the renewal's complete guardian-track path is 1 + 7 + 1 + 2 = 11 days, not
  the seven-day decision period alone, leaving three days of mathematical
  submission slack. The 28-day freeze budget is per activation: after expiry
  a fresh activation has a fresh renewal count, so the prose's unqualified
  "total freeze duration" does not establish a per-incident ceiling.

Units: VIT quantities are whole tokens and day quantities are exact
``Fraction`` values. USDC is ``Decimal`` at six-decimal base-unit precision.
Conversion rounds down, against the guardian as collateral claimant: rounding
up would overstate the accountable capital. Timing is not rounded.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN, localcontext
from fractions import Fraction
from typing import Literal

WORK_PREC = 50
USDC_QUANTUM = Decimal("0.000001")

# ---------------------------------------------------------------------------
# 06 §5.1 / 13 §1 `grd.bond` and the guardian body constants.
# ---------------------------------------------------------------------------

GUARDIAN_SEATS = 7
GUARDIAN_THRESHOLD = 5
GUARDIAN_BOND_VIT = 50_000  # 13 §1 `grd.bond` (scope-K, entrenched).
REVIEW_SLASH_FRACTION = Fraction(1, 2)  # 06 §5.4(3), per failed review.

# 13 §1 `fee.vit_usdc_rate`: the reference remains [VERIFY at TGE]. The
# lawful envelope is expressed as a multiple of that kernel reference.
VIT_USDC_RATE_REF = Decimal("0.05")
VIT_USDC_RATE_MIN = VIT_USDC_RATE_REF * Decimal("0.1")
VIT_USDC_RATE_MAX = VIT_USDC_RATE_REF * Decimal(10)


class GuardianDerivationError(ValueError):
    """An invalid economic or timing input refuses rather than producing evidence."""


def _usdc_floor(value: Decimal) -> Decimal:
    """Round collateral value down to one USDC base unit (against claimant)."""
    return value.quantize(USDC_QUANTUM, rounding=ROUND_DOWN)


def seat_bond_usdc(vit_usdc_rate: Decimal = VIT_USDC_RATE_REF) -> Decimal:
    """Price one 50,000-VIT guardian seat in USDC.

    The rate is an input because 13 §1 marks the 0.05 reference ``[VERIFY at
    TGE]`` and permits the live key to move over ``[0.1× ref, 10× ref]``.
    A non-positive rate refuses. The product rounds down to six decimals: an
    upward valuation would overstate collateral in the unsafe direction.
    """
    if vit_usdc_rate <= 0:
        raise GuardianDerivationError("fee.vit_usdc_rate must be positive")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _usdc_floor(Decimal(GUARDIAN_BOND_VIT) * vit_usdc_rate)


@dataclass(frozen=True)
class BondStack:
    """Guardian collateral at one VIT/USDC rate.

    ``directly_movable_usdc`` is zero by 06 §5.2's kernel prohibitions. It is
    included to prevent the bond from being compared with an invented
    extractable-value target: guardian powers are subtractive and may cause
    obstruction, but they cannot move protocol funds.
    """

    vit_usdc_rate: Decimal
    seat_usdc: Decimal
    approving_coalition_usdc: Decimal
    full_set_usdc: Decimal
    directly_movable_usdc: Decimal


def bond_stack(vit_usdc_rate: Decimal = VIT_USDC_RATE_REF) -> BondStack:
    """Price one seat, a 5-of-7 coalition and the full seven-seat set."""
    seat = seat_bond_usdc(vit_usdc_rate)
    return BondStack(
        vit_usdc_rate=vit_usdc_rate,
        seat_usdc=_usdc_floor(seat),
        approving_coalition_usdc=_usdc_floor(seat * GUARDIAN_THRESHOLD),
        full_set_usdc=_usdc_floor(seat * GUARDIAN_SEATS),
        directly_movable_usdc=Decimal(0).quantize(USDC_QUANTUM),
    )


def lawful_bond_stack_envelope() -> tuple[BondStack, BondStack]:
    """The endpoint sweep of 13 §1's lawful VIT/USDC rate envelope.

    The pricing functions are positive linear maps of the rate, so the two
    endpoints are also the exact extrema over the continuous lawful interval.
    """
    return bond_stack(VIT_USDC_RATE_MIN), bond_stack(VIT_USDC_RATE_MAX)


# ---------------------------------------------------------------------------
# 06 §5.4(3) — repeated failed-review liability.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Liability:
    """One seat's constant-slash ladder after ``failures`` failed reviews."""

    failures: int
    initial_bond_vit: int
    nominal_slash_per_failure_vit: int
    cumulative_slashed_vit: int
    remaining_bond_vit: int
    next_failure_slash_vit: int

    @property
    def exhausted(self) -> bool:
        return self.remaining_bond_vit == 0


def lifetime_liability(n_failures: int) -> Liability:
    """Apply §5.4(3)'s 50%-of-seat-bond slash with saturation at zero.

    The slash base is the 50,000-VIT seat bond, not the remaining balance.
    Fifty percent is integral here; were it not, a slash would round up because
    rounding a charge down is claimant-favouring. Actual cumulative slashing
    cannot exceed the held bond.
    """
    if isinstance(n_failures, bool) or not isinstance(n_failures, int):
        raise GuardianDerivationError("failure count must be an integer")
    if n_failures < 0:
        raise GuardianDerivationError("failure count cannot be negative")
    nominal = Fraction(GUARDIAN_BOND_VIT) * REVIEW_SLASH_FRACTION
    if nominal.denominator != 1:
        nominal_slash = -(-nominal.numerator // nominal.denominator)
    else:
        nominal_slash = nominal.numerator
    cumulative = min(GUARDIAN_BOND_VIT, n_failures * nominal_slash)
    remaining = GUARDIAN_BOND_VIT - cumulative
    return Liability(
        failures=n_failures,
        initial_bond_vit=GUARDIAN_BOND_VIT,
        nominal_slash_per_failure_vit=nominal_slash,
        cumulative_slashed_vit=cumulative,
        remaining_bond_vit=remaining,
        next_failure_slash_vit=min(nominal_slash, remaining),
    )


def member_can_propose_or_approve(*, is_member: bool, remaining_bond_vit: int) -> bool:
    """06 §5.1's action gate, which tests membership and not remaining bond.

    This is also the shipped gate at commit ``0b160ab``: both action calls use
    the pure membership check, while the bond balance is not read. The balance
    is accepted here so the missing composition is executable rather than
    hidden in prose; changing it does not change the verdict.
    """
    if remaining_bond_vit < 0:
        raise GuardianDerivationError("remaining bond cannot be negative")
    return is_member


@dataclass(frozen=True)
class Finding:
    """A queryable consequence of composing the document's rules."""

    key: str
    ok: bool
    detail: str


def accountability_findings(n_failures: int = 2) -> tuple[Finding, ...]:
    """Evaluate the liability and action-gate composition (SQ-558)."""
    liability = lifetime_liability(n_failures)
    can_act = member_can_propose_or_approve(
        is_member=True, remaining_bond_vit=liability.remaining_bond_vit
    )
    return (
        Finding(
            key="remaining liability after repeated review failures",
            ok=liability.remaining_bond_vit > 0,
            detail=f"{liability.remaining_bond_vit} VIT remains",
        ),
        Finding(
            key="action eligibility requires remaining liability",
            ok=liability.remaining_bond_vit > 0 or not can_act,
            detail=(
                f"member_can_act={can_act} at "
                f"{liability.remaining_bond_vit} VIT remaining"
            ),
        ),
    )


# ---------------------------------------------------------------------------
# 06 §5.4 — review failure and successful recall latency.
# ---------------------------------------------------------------------------

DeadlineMode = Literal["shipped-strict-epoch", "exact-duration"]

# 13 §1 registry rows, expressed in days for composition with 06 §2.1.
EPOCH_LENGTH_DAYS_DEFAULT = Fraction(21)
EPOCH_LENGTH_DAYS_MIN = Fraction(14)
EPOCH_LENGTH_DAYS_MAX = Fraction(42)
REVIEW_DEADLINE_EPOCHS_DEFAULT = 2  # 13 §1 `grd.review_dl`.
REVIEW_DEADLINE_EPOCHS_MIN = 1
REVIEW_DEADLINE_EPOCHS_MAX = 4


@dataclass(frozen=True)
class TrackSchedule:
    """Worst-case submission-to-enactment stages for one values track."""

    prepare_days: Fraction
    decision_days: Fraction
    confirm_days: Fraction
    enactment_days: Fraction

    @property
    def latency_days(self) -> Fraction:
        return (
            self.prepare_days
            + self.decision_days
            + self.confirm_days
            + self.enactment_days
        )


# 06 §2.1 `guardian`: prepare 1 d / decision 7 d / confirm 1 d / enactment 2 d.
GUARDIAN_TRACK = TrackSchedule(Fraction(1), Fraction(7), Fraction(1), Fraction(2))


@dataclass(frozen=True)
class CaptureRun:
    """Worst-case successful recall of a coalition after one obstructive action.

    This is conditional on the recall referendum passing at the end of its
    decision period. If it does not pass, 06 §5.4 supplies no finite removal
    bound. The strict-epoch case also assumes the action lands just after an
    epoch boundary, which maximizes the wait to ``current_epoch > deadline``.
    """

    deadline_mode: DeadlineMode
    review_deadline_epochs: int
    epoch_length_days: Fraction
    review_wait_days: Fraction
    recall_track_days: Fraction
    obstruction_days: Fraction

    @property
    def obstruction_cycles(self) -> Fraction:
        """The successful-recall obstruction interval in epoch cycles."""
        return self.obstruction_days / self.epoch_length_days


def capture_run(
    review_deadline_epochs: int = REVIEW_DEADLINE_EPOCHS_DEFAULT,
    epoch_length_days: Fraction | int = EPOCH_LENGTH_DAYS_DEFAULT,
    *,
    deadline_mode: DeadlineMode = "shipped-strict-epoch",
) -> CaptureRun:
    """Compose review failure with the full guardian-track recall schedule.

    ``shipped-strict-epoch`` is 06 §5.4's permitted interim implementation:
    failure occurs only when ``current_epoch > action_epoch + review_dl``, so
    the worst wait is ``(review_dl + 1) * epoch.length``. ``exact-duration`` is
    the document's preferred block deadline and waits exactly
    ``review_dl * epoch.length``. Both then add prepare, decision, confirmation
    and enactment; omitting confirmation is the unsafe underestimate.
    """
    epoch_days = Fraction(epoch_length_days)
    if not REVIEW_DEADLINE_EPOCHS_MIN <= review_deadline_epochs <= REVIEW_DEADLINE_EPOCHS_MAX:
        raise GuardianDerivationError(
            "grd.review_dl outside its 13 §1 [1, 4] epoch bounds"
        )
    if not EPOCH_LENGTH_DAYS_MIN <= epoch_days <= EPOCH_LENGTH_DAYS_MAX:
        raise GuardianDerivationError(
            "epoch.length outside its 13 §1 [14 d, 42 d] bounds"
        )
    if deadline_mode == "shipped-strict-epoch":
        review_wait = (review_deadline_epochs + 1) * epoch_days
    elif deadline_mode == "exact-duration":
        review_wait = review_deadline_epochs * epoch_days
    else:
        raise GuardianDerivationError(f"unknown deadline mode {deadline_mode!r}")
    recall = GUARDIAN_TRACK.latency_days
    return CaptureRun(
        deadline_mode=deadline_mode,
        review_deadline_epochs=review_deadline_epochs,
        epoch_length_days=epoch_days,
        review_wait_days=review_wait,
        recall_track_days=recall,
        obstruction_days=review_wait + recall,
    )


# ---------------------------------------------------------------------------
# 06 §6.3 — PB-LEDGER-FREEZE renewal and activation budget.
# ---------------------------------------------------------------------------

PLAYBOOK_FREEZE_WINDOW_DAYS = Fraction(14)  # 13 §2 kernel activation window.
LEDGER_FREEZE_RENEWALS = 1


def renewal_slack(
    window_days: Fraction | int = PLAYBOOK_FREEZE_WINDOW_DAYS,
) -> Fraction:
    """Window minus the complete guardian-track renewal latency.

    A negative result means a worst-case renewal cannot enact before expiry.
    The default is ``14 - (1 + 7 + 1 + 2) = 3`` days. This is mathematical
    schedule slack; same-block ordering at the exact expiry boundary is not an
    extra day and is deliberately not assumed.
    """
    window = Fraction(window_days)
    if window <= 0:
        raise GuardianDerivationError("renewal window must be positive")
    return window - GUARDIAN_TRACK.latency_days


def renewal_record_available(now_days: Fraction | int, expiry_days: Fraction | int) -> bool:
    """Whether the active record needed by ``renew_playbook`` still exists.

    06 §6.3 says the activation auto-expires; the shipped expiry rule removes
    it at ``now >= expiry``. A late renewal therefore refuses rather than
    reviving the expired activation.
    """
    now, expiry = Fraction(now_days), Fraction(expiry_days)
    if now < 0 or expiry < 0:
        raise GuardianDerivationError("playbook times cannot be negative")
    return now < expiry


def activation_freeze_budget(
    renewals: int = LEDGER_FREEZE_RENEWALS,
    window_days: Fraction | int = PLAYBOOK_FREEZE_WINDOW_DAYS,
) -> Fraction:
    """Maximum window budget for one activation and its permitted renewal."""
    if isinstance(renewals, bool) or not isinstance(renewals, int):
        raise GuardianDerivationError("renewal count must be an integer")
    if not 0 <= renewals <= LEDGER_FREEZE_RENEWALS:
        raise GuardianDerivationError("PB-LEDGER-FREEZE permits at most one renewal")
    window = Fraction(window_days)
    if window <= 0:
        raise GuardianDerivationError("activation window must be positive")
    return (renewals + 1) * window


def incident_freeze_budget(
    activations: int,
    *,
    renewals_per_activation: int = LEDGER_FREEZE_RENEWALS,
) -> Fraction:
    """Aggregate upper budget of fresh post-expiry activation records.

    The document and shipped state machine reject a duplicate while the first
    record is active, but after expiry a new 5-of-7 activation starts with
    ``renewals_used = 0``. Consequently 28 days is a per-activation statement,
    not a finite incident bound. This function totals the per-activation upper
    bounds for a finite number of such activations; it does not assume a
    same-block renewal or zero-gap reactivation. The mechanism publishes no
    maximum activation count per incident while the I-4 trigger remains live.
    """
    if isinstance(activations, bool) or not isinstance(activations, int):
        raise GuardianDerivationError("activation count must be an integer")
    if activations < 0:
        raise GuardianDerivationError("activation count cannot be negative")
    return activations * activation_freeze_budget(renewals_per_activation)
