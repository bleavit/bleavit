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
* "50% of bond" has two exact readings. Applied to the live held bond it
  halves 50,000 → 25,000 → 12,500 → … and never reaches zero; applied to the
  original seat bond it charges 25,000 each time and saturates after two. The
  document does not choose a basis. Under either reading §5.1's action gate is
  membership-only and does not inspect the remaining bond;
* the documented strict epoch-index fallback plus a successful guardian-track
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
up would overstate the accountable capital. Bond ladders use exact
``Fraction`` VIT and timing is not rounded.
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


SlashBasis = Literal["live-held-bond", "original-seat-bond"]


@dataclass(frozen=True)
class Liability:
    """One seat's exact ladder under an explicit reading of "bond"."""

    failures: int
    slash_basis: SlashBasis
    initial_bond_vit: Fraction
    first_failure_slash_vit: Fraction
    last_failure_slash_vit: Fraction
    cumulative_slashed_vit: Fraction
    remaining_bond_vit: Fraction
    next_failure_slash_vit: Fraction

    @property
    def exhausted(self) -> bool:
        return self.remaining_bond_vit == 0


def lifetime_liability(n_failures: int, *, slash_basis: SlashBasis) -> Liability:
    """Apply §5.4(3) under one explicit slash-basis scenario.

    ``live-held-bond`` applies 50% to the balance currently held. It remains a
    positive exact fraction after every finite failure count. ``original-seat-
    bond`` applies 50% of 50,000 VIT on every failure and saturates at the held
    amount. The document's phrase "50% of bond" does not select between them.
    """
    if isinstance(n_failures, bool) or not isinstance(n_failures, int):
        raise GuardianDerivationError("failure count must be an integer")
    if n_failures < 0:
        raise GuardianDerivationError("failure count cannot be negative")
    initial = Fraction(GUARDIAN_BOND_VIT)
    first_slash = initial * REVIEW_SLASH_FRACTION
    if slash_basis == "live-held-bond":
        remaining = initial * (1 - REVIEW_SLASH_FRACTION) ** n_failures
        cumulative = initial - remaining
        last_slash = (
            Fraction(0)
            if n_failures == 0
            else initial
            * (1 - REVIEW_SLASH_FRACTION) ** (n_failures - 1)
            * REVIEW_SLASH_FRACTION
        )
        next_slash = remaining * REVIEW_SLASH_FRACTION
    elif slash_basis == "original-seat-bond":
        cumulative = min(initial, n_failures * first_slash)
        remaining = initial - cumulative
        previous_cumulative = min(initial, max(0, n_failures - 1) * first_slash)
        last_slash = cumulative - previous_cumulative
        next_slash = min(first_slash, remaining)
    else:
        raise GuardianDerivationError(f"unknown slash basis {slash_basis!r}")
    return Liability(
        failures=n_failures,
        slash_basis=slash_basis,
        initial_bond_vit=initial,
        first_failure_slash_vit=first_slash,
        last_failure_slash_vit=last_slash,
        cumulative_slashed_vit=cumulative,
        remaining_bond_vit=remaining,
        next_failure_slash_vit=next_slash,
    )


def member_can_propose_or_approve(
    *, is_member: bool, remaining_bond_vit: Fraction | int
) -> bool:
    """06 §5.1's action gate, which tests membership and not remaining bond.

    §5.1 says any member may call both action methods and names no live-bond
    precondition. The balance is accepted here so the documented composition
    is executable rather than hidden in prose; changing it does not change the
    verdict.
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


def accountability_findings(
    n_failures: int, *, slash_basis: SlashBasis
) -> tuple[Finding, ...]:
    """Report SQ-558's ambiguity and one conditional ladder result."""
    liability = lifetime_liability(n_failures, slash_basis=slash_basis)
    other_basis: SlashBasis = (
        "original-seat-bond"
        if slash_basis == "live-held-bond"
        else "live-held-bond"
    )
    other = lifetime_liability(n_failures, slash_basis=other_basis)
    can_act = member_can_propose_or_approve(
        is_member=True, remaining_bond_vit=liability.remaining_bond_vit
    )
    return (
        Finding(
            key="06.review-slash-basis-is-specified",
            ok=False,
            detail=(
                f"after {n_failures} failures: {slash_basis} leaves "
                f"{liability.remaining_bond_vit} VIT; {other_basis} leaves "
                f"{other.remaining_bond_vit} VIT"
            ),
        ),
        Finding(
            key="06.action-gate-is-membership-only",
            ok=can_act,
            detail=(
                f"conditional {slash_basis} ladder: member_can_act={can_act} "
                f"at {liability.remaining_bond_vit} VIT remaining"
            ),
        ),
    )


# ---------------------------------------------------------------------------
# 06 §5.4 — review failure and successful recall latency.
# ---------------------------------------------------------------------------

DeadlineMode = Literal["strict-epoch-fallback", "exact-duration"]

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
    deadline_mode: DeadlineMode = "strict-epoch-fallback",
) -> CaptureRun:
    """Compose review failure with the full guardian-track recall schedule.

    ``strict-epoch-fallback`` is 06 §5.4's permitted interim implementation:
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
    if deadline_mode == "strict-epoch-fallback":
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

    06 §6.3 says the activation auto-expires; its expiry rule removes
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

    The documented state machine rejects a duplicate while the first
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
