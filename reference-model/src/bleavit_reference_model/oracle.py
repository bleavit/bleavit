"""07 §4, §8; 08 §1.2, §10 — reserve-probe and watchtower liveness.

Doc 07 makes the Asset Hub reserve probe a fail-static state machine.  The
probe spends one ceil-rounded ``ops.reserve_probe`` envelope per accepted
attempt, enters ``ReserveUnhealthy`` after ``res.fail_threshold`` consecutive
failures, and leaves only after ``res.recover_threshold`` consecutive passes.
Its first arm requires ``F + R`` envelopes.  Doc 08 then blocks every *new*
TREASURY decision while unhealthy but deliberately leaves ``fund_budget_line``
dispatchable, so a refill that was already armed may still execute.

Executing those rules produces a narrower result than "PB-RESERVE is
absorbing".  At the genesis ``F = 2``, ``R = 3`` and five-envelope first-arm
floor, an optimistic operator that tops the line back up while it is still
healthy survives at most **three** consecutive remote-failure probe-days; the
fourth leaves too few envelopes for recovery.  The unhealthy state is
absorbing exactly when funded envelopes plus an already-armed refill cannot
pay for the remaining consecutive passes.  A sufficiently large pre-armed
refill escapes it because the funding dispatchable remains callable under the
flag.  No unhealthy state can arm a new one.

The same transition machine gives an exact stationary unhealthy duty cycle of
163/20,740 (0.7859 %) at a 5 % independent probe-failure rate, 271/8,290
(3.2690 %) at 10 %, 61/445 (13.7079 %) at 20 %, and 28/55 (50.9091 %) at
40 %.  Those figures assume unbounded funding and therefore measure only the
health hysteresis, not line exhaustion.

The funding arithmetic has no hidden margin.  The governed defaults debit
2,500,000 micro-USDC = 2.5 USDC per attempt.  The exact cadence burns 52.5
USDC per 21-day epoch and 913.125 USDC per 365.25-day year.  Doc 08 §10 prints
those as approximate whole-USDC figures ``≈52`` and ``≈913``; treating the
display values as allocations would make them short by 0.5 and 0.125 USDC,
respectively.  The table's stated basis is exactly routine burn, hence zero
buffer, while the actual ``ops.reserve_probe`` allocation remains ``[VERIFY]``.

The first-arm runway is not re-checked by any stated threshold-amendment rule.
Because ``res.recover_threshold`` is an un-delta-limited ``u8``, one lawful
amendment reaches 255.  With the still-default failure threshold, the same
relationship then requires 257 envelopes = 642.5 USDC, not the audit brief's
256 envelopes / 640 USDC (which silently also changes ``res.fail_threshold``
from 2 to 1).

Doc 07's watchtower floor is likewise checked only at MetricSpec registration.
From the minimum two seats, one liveness ejection leaves one seat below quorum;
or one lawful ``wt.quorum`` amendment raises 2 to 3 while both seats remain.
This degrades unchallenged rounds only, and is not absorbing: registration is
permissionless-with-stake up to 16 seats.  The only fully specified way for a
watchtower to unlock voluntarily is deliberate inactivity for two observed
work epochs: one 10 % slash, 2,500 USDC at genesis, then 90 % release.  There is
no ``deregister_watchtower`` call.  Moreover, §4's delegations of watchtower
recall to doc 06 and of the independent-entity rule to doc 05 do not resolve:
doc 06 never mentions watchtowers, and doc 05 names "registry entities" but
defines neither the referenced registry nor the no-two-seats rule.

Units are envelope counts and blocks unless named otherwise.  Money arithmetic
uses integer micro-USDC; ratios and probabilities use :class:`fractions.Fraction`.
The probe debit and watchtower slash round **up**, against the treasury and the
exiting claimant respectively (R-7); no binary float enters an economic result.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from fractions import Fraction
from itertools import product
from pathlib import Path


class OracleModelError(ValueError):
    """A malformed or unreachable oracle-model operation refuses (G-1)."""


def ceil_div(numerator: int, denominator: int) -> int:
    """Integer division rounded up, against the party paying or exiting."""
    if denominator <= 0:
        raise OracleModelError(f"non-positive divisor {denominator}")
    if numerator < 0:
        raise OracleModelError(f"negative dividend {numerator}")
    return -(-numerator // denominator)


# ---------------------------------------------------------------------------
# 13 §1 registry values and the 08 §10 presentation figures.
# ---------------------------------------------------------------------------

BLOCKS_PER_DAY = 14_400
EPOCH_LENGTH_BLOCKS = 302_400  # 13 §1 `epoch.length` default.
DAYS_PER_YEAR = Fraction(1_461, 4)  # 08 §10's 365.25-day convention.

MICRO_USDC_PER_USDC = 1_000_000
PLANCK_PER_DOT = 10_000_000_000

# 13 §1 `res.probe_interval` (`res.probe_int`).
RES_PROBE_INTERVAL_DEFAULT = 14_400
# 13 §1 `res.fail_threshold` / `res.recover_threshold`.
RES_FAIL_THRESHOLD_DEFAULT = 2
RES_RECOVER_THRESHOLD_DEFAULT = 3
RES_THRESHOLD_MIN = 1
# The row has no numeric maximum and the value kind is `u8` (13 §1).
RES_THRESHOLD_MAX = (1 << 8) - 1

# 13 §1 `ops.probe_fee_dot` / `ops.probe_dot_rate`.
OPS_PROBE_FEE_DOT_DEFAULT = 5_000_000_000
OPS_PROBE_DOT_RATE_DEFAULT = 5_000_000

# 13 §1 leaves the `ops.reserve_probe` allocation [VERIFY].  These are only
# 08 §10.1's approximate presentation figures, never promoted to a registry
# value by this model.
OPS_RESERVE_PROBE_BUDGET_DEFAULT_MICRO_USDC: int | None = None
PROBE_COST_EPOCH_DISPLAY_USDC = 52
PROBE_COST_YEAR_DISPLAY_USDC = 913
# 08 §10.1's Basis column independently states "21 probes × envelope".  Keep
# this separate from `epoch.length / res.probe_interval`: their equality is the
# zero-buffer finding, not an identity the model is allowed to assume.
PROBE_COST_BASIS_PROBES_PER_EPOCH = 21

# 13 §1 `wt.quorum`, `wt.stake`; 13 §2 `wt.max`.
WT_QUORUM_DEFAULT, WT_QUORUM_MIN, WT_QUORUM_MAX, WT_QUORUM_MAX_DELTA = (
    2,
    2,
    5,
    1,
)
WT_STAKE_DEFAULT = 25_000
WT_MAX = 16
WT_INACTIVITY_EPOCHS = 2
WT_INACTIVITY_SLASH = Fraction(10, 100)


@dataclass(frozen=True)
class Finding:
    """One executable claim: ``ok=False`` makes a defect queryable."""

    key: str
    ok: bool
    detail: str


# ---------------------------------------------------------------------------
# 07 §8 — envelope and funding arithmetic.
# ---------------------------------------------------------------------------


def probe_envelope_micro_usdc(
    fee_dot_planck: int = OPS_PROBE_FEE_DOT_DEFAULT,
    dot_rate_micro_usdc: int = OPS_PROBE_DOT_RATE_DEFAULT,
) -> int:
    """``ceil(fee_dot × rate / 10^10)`` micro-USDC (07 §8).

    The debit rounds up.  Rounding down under-authorizes the attempt and makes
    the accounting line report less burn than the probe can consume.
    """
    return ceil_div(fee_dot_planck * dot_rate_micro_usdc, PLANCK_PER_DOT)


def first_arm_runway_envelopes(
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
) -> int:
    """07 §8's first-arm ``F + R`` envelope floor."""
    _validate_thresholds(fail_threshold, recover_threshold)
    return fail_threshold + recover_threshold


def runway_micro_usdc(
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
    envelope_micro_usdc: int = probe_envelope_micro_usdc(),
) -> int:
    """The first-arm runway in micro-USDC, with no intermediate rounding."""
    if envelope_micro_usdc <= 0:
        raise OracleModelError("a probe envelope must be positive")
    return first_arm_runway_envelopes(fail_threshold, recover_threshold) * envelope_micro_usdc


@dataclass(frozen=True)
class ProbeFunding:
    """08 §10's probe row separated into derivation and displayed rounding."""

    envelope_micro_usdc: int
    probes_per_epoch: Fraction
    probes_per_year: Fraction
    booked_epoch_micro_usdc: Fraction
    booked_year_micro_usdc: Fraction
    routine_epoch_micro_usdc: Fraction
    routine_year_micro_usdc: Fraction
    display_epoch_micro_usdc: int
    display_year_micro_usdc: int

    @property
    def exact_basis_buffer_epoch_micro_usdc(self) -> Fraction:
        """The row's basis is cadence × envelope, so its economic buffer is 0."""
        return self.booked_epoch_micro_usdc - self.routine_epoch_micro_usdc

    @property
    def display_epoch_margin_micro_usdc(self) -> Fraction:
        """Displayed whole-USDC figure minus exact epoch consumption."""
        return Fraction(self.display_epoch_micro_usdc) - self.routine_epoch_micro_usdc

    @property
    def display_year_margin_micro_usdc(self) -> Fraction:
        """Displayed whole-USDC figure minus exact 365.25-day consumption."""
        return Fraction(self.display_year_micro_usdc) - self.routine_year_micro_usdc

    @property
    def display_epoch_margin_fraction(self) -> Fraction:
        return self.display_epoch_margin_micro_usdc / self.routine_epoch_micro_usdc

    @property
    def display_year_margin_fraction(self) -> Fraction:
        return self.display_year_margin_micro_usdc / self.routine_year_micro_usdc


def probe_funding() -> ProbeFunding:
    """Re-derive 08 §10.1's ``ops.reserve_probe`` row exactly."""
    envelope = probe_envelope_micro_usdc()
    probes_epoch = Fraction(EPOCH_LENGTH_BLOCKS, RES_PROBE_INTERVAL_DEFAULT)
    probes_year = DAYS_PER_YEAR  # interval is exactly one day.
    booked_epoch = Fraction(PROBE_COST_BASIS_PROBES_PER_EPOCH * envelope)
    epochs_year = DAYS_PER_YEAR / Fraction(EPOCH_LENGTH_BLOCKS, BLOCKS_PER_DAY)
    return ProbeFunding(
        envelope_micro_usdc=envelope,
        probes_per_epoch=probes_epoch,
        probes_per_year=probes_year,
        booked_epoch_micro_usdc=booked_epoch,
        booked_year_micro_usdc=booked_epoch * epochs_year,
        routine_epoch_micro_usdc=probes_epoch * envelope,
        routine_year_micro_usdc=probes_year * envelope,
        display_epoch_micro_usdc=PROBE_COST_EPOCH_DISPLAY_USDC * MICRO_USDC_PER_USDC,
        display_year_micro_usdc=PROBE_COST_YEAR_DISPLAY_USDC * MICRO_USDC_PER_USDC,
    )


def funding_findings() -> tuple[Finding, ...]:
    """SQ-554's structured funding result."""
    funding = probe_funding()
    return (
        Finding(
            "ops.reserve_probe routine-burn buffer",
            funding.exact_basis_buffer_epoch_micro_usdc > 0,
            "08 §10's stated 21-probe basis equals routine burn exactly; "
            "it adds no outage or fee-rate buffer",
        ),
        Finding(
            "ops.reserve_probe allocation is calibrated",
            OPS_RESERVE_PROBE_BUDGET_DEFAULT_MICRO_USDC is not None,
            "13 §1 leaves the actual line allocation [VERIFY]; §10 is cost "
            "accounting, not a funded-balance record",
        ),
    )


# ---------------------------------------------------------------------------
# 07 §8 + 08 §1.2 — explicit reserve-probe state machine.
# ---------------------------------------------------------------------------


def _validate_thresholds(fail_threshold: int, recover_threshold: int) -> None:
    for name, value in (
        ("res.fail_threshold", fail_threshold),
        ("res.recover_threshold", recover_threshold),
    ):
        if not RES_THRESHOLD_MIN <= value <= RES_THRESHOLD_MAX:
            raise OracleModelError(
                f"{name} {value} outside u8 range "
                f"[{RES_THRESHOLD_MIN}, {RES_THRESHOLD_MAX}]"
            )


@dataclass(frozen=True)
class ReserveProbe:
    """The local envelope ledger and health hysteresis of 07 §8.

    ``armed_refill_envelopes`` represents a TREASURY decision that qualified
    before the reserve flag rose.  :meth:`arm_refill` models qualification;
    :meth:`execute_refill` models the still-dispatchable ``fund_budget_line``.
    That split is what makes absorption conditional rather than universal.
    """

    envelopes: int
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT
    consecutive_fails: int = 0
    consecutive_passes: int = 0
    unhealthy: bool = False
    probe_armed: bool = True
    armed_refill_envelopes: int = 0

    def __post_init__(self) -> None:
        _validate_thresholds(self.fail_threshold, self.recover_threshold)
        if self.envelopes < 0 or self.armed_refill_envelopes < 0:
            raise OracleModelError("negative envelope balance")
        if self.consecutive_fails < 0 or self.consecutive_passes < 0:
            raise OracleModelError("negative consecutive counter")
        if self.consecutive_fails and self.consecutive_passes:
            raise OracleModelError("fail and pass streaks cannot both be non-zero")
        if not self.unhealthy:
            if self.consecutive_fails >= self.fail_threshold:
                raise OracleModelError("healthy state already meets fail threshold")
            if self.consecutive_passes:
                raise OracleModelError("healthy state does not retain a pass streak")
        elif self.consecutive_passes >= self.recover_threshold:
            raise OracleModelError("unhealthy state already meets recovery threshold")

    @classmethod
    def unarmed(
        cls,
        envelopes: int,
        fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
        recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
    ) -> "ReserveProbe":
        """The pre-measurement state; wall-clock slots here are not scored."""
        return cls(
            envelopes=envelopes,
            fail_threshold=fail_threshold,
            recover_threshold=recover_threshold,
            probe_armed=False,
        )

    def arm_probe(self) -> "ReserveProbe":
        """First arm, refusing below §8's live ``F + R`` runway."""
        if self.probe_armed:
            raise OracleModelError("reserve probe is already armed")
        required = first_arm_runway_envelopes(
            self.fail_threshold, self.recover_threshold
        )
        if self.envelopes < required:
            raise OracleModelError(
                f"first arm needs {required} envelopes, has {self.envelopes}"
            )
        return replace(self, probe_armed=True)

    @property
    def can_arm_refill(self) -> bool:
        """A new TREASURY refill decision can arm only while NAV is healthy."""
        return not self.unhealthy

    def arm_refill(self, envelopes: int) -> "ReserveProbe":
        """Arm one future refill decision; no direct funding occurs here."""
        if not self.can_arm_refill:
            raise OracleModelError("ReserveUnhealthy blocks a new refill decision")
        if envelopes <= 0:
            raise OracleModelError("a refill must be positive")
        if self.armed_refill_envelopes:
            raise OracleModelError("a refill is already armed")
        return replace(self, armed_refill_envelopes=envelopes)

    def execute_refill(self) -> "ReserveProbe":
        """Execute an armed ``fund_budget_line``, including while unhealthy."""
        if self.armed_refill_envelopes <= 0:
            raise OracleModelError("no armed refill to execute")
        return replace(
            self,
            envelopes=self.envelopes + self.armed_refill_envelopes,
            armed_refill_envelopes=0,
        )

    def advance(self, remote_success: bool) -> "ProbeStep":
        """Score one completed cadence slot.

        A funded attempt consumes one envelope whether its timely authenticated
        result passes or fails.  With no envelope, no attempt can open and the
        completed slot scores failure regardless of the hypothetical remote
        outcome (07 §8's fail-static no-attempt rule).
        """
        if not self.probe_armed:
            raise OracleModelError("pre-arm wall-clock slots are not scored")
        attempted = self.envelopes > 0
        scored_pass = attempted and remote_success
        envelopes = self.envelopes - int(attempted)

        if scored_pass:
            if not self.unhealthy:
                state = replace(
                    self,
                    envelopes=envelopes,
                    consecutive_fails=0,
                    consecutive_passes=0,
                )
                return ProbeStep(state, attempted=True, scored_pass=True)
            passes = self.consecutive_passes + 1
            if passes >= self.recover_threshold:
                state = replace(
                    self,
                    envelopes=envelopes,
                    consecutive_fails=0,
                    consecutive_passes=0,
                    unhealthy=False,
                )
            else:
                state = replace(
                    self,
                    envelopes=envelopes,
                    consecutive_fails=0,
                    consecutive_passes=passes,
                )
            return ProbeStep(state, attempted=True, scored_pass=True)

        fails = min(RES_THRESHOLD_MAX, self.consecutive_fails + 1)
        unhealthy = self.unhealthy or fails >= self.fail_threshold
        state = replace(
            self,
            envelopes=envelopes,
            consecutive_fails=fails,
            consecutive_passes=0,
            unhealthy=unhealthy,
        )
        return ProbeStep(state, attempted=attempted, scored_pass=False)


@dataclass(frozen=True)
class ProbeStep:
    """One cadence result, including whether a funded attempt existed."""

    state: ReserveProbe
    attempted: bool
    scored_pass: bool


def is_absorbing(state: ReserveProbe) -> bool:
    """Whether no permitted future can clear ``ReserveUnhealthy``.

    The best possible future executes any pre-armed refill and then receives
    only timely successes.  If those available envelopes cannot finish the
    remaining recovery streak, the line reaches zero and every later slot is a
    no-attempt failure.  Healthy states can arm a refill and are not absorbing.
    """
    if not state.unhealthy:
        return False
    remaining_passes = state.recover_threshold - state.consecutive_passes
    available = state.envelopes + state.armed_refill_envelopes
    required = (
        remaining_passes
        if state.probe_armed
        else max(
            remaining_passes,
            first_arm_runway_envelopes(
                state.fail_threshold, state.recover_threshold
            ),
        )
    )
    return available < required


def probe_successors(
    state: ReserveProbe, refill_envelopes: int = 1
) -> tuple[ReserveProbe, ...]:
    """All one-action successors used by bounded reachability proofs."""
    successors: set[ReserveProbe] = set()
    if state.probe_armed:
        successors.add(state.advance(False).state)
        successors.add(state.advance(True).state)
    elif state.envelopes >= first_arm_runway_envelopes(
        state.fail_threshold, state.recover_threshold
    ):
        successors.add(state.arm_probe())
    if state.can_arm_refill and not state.armed_refill_envelopes:
        successors.add(state.arm_refill(refill_envelopes))
    if state.armed_refill_envelopes:
        successors.add(state.execute_refill())
    return tuple(
        sorted(
            successors,
            key=lambda s: (
                s.unhealthy,
                s.envelopes,
                s.armed_refill_envelopes,
                s.consecutive_fails,
                s.consecutive_passes,
            ),
        )
    )


def reachable_probe_states(
    initial: ReserveProbe, actions: int, refill_envelopes: int = 1
) -> frozenset[ReserveProbe]:
    """Every state reachable within ``actions`` probe/refill actions."""
    if actions < 0:
        raise OracleModelError("negative reachability depth")
    if refill_envelopes <= 0:
        raise OracleModelError("refill action must be positive")
    seen = {initial}
    frontier = {initial}
    for _ in range(actions):
        nxt: set[ReserveProbe] = set()
        for state in frontier:
            for successor in probe_successors(state, refill_envelopes):
                if successor not in seen:
                    seen.add(successor)
                    nxt.add(successor)
        frontier = nxt
        if not frontier:
            break
    return frozenset(seen)


def can_reach_healthy(state: ReserveProbe, actions: int) -> bool:
    """Exhaustively ask whether some permitted future reaches healthy state."""
    if not state.unhealthy:
        return True
    frontier = {state}
    seen = {state}
    for _ in range(actions):
        nxt: set[ReserveProbe] = set()
        for current in frontier:
            # While unhealthy, only probe outcomes and execution of a decision
            # armed earlier are available; arm_refill is deliberately absent.
            choices: list[ReserveProbe] = []
            if current.probe_armed:
                choices.extend(
                    (current.advance(False).state, current.advance(True).state)
                )
            elif current.envelopes >= first_arm_runway_envelopes(
                current.fail_threshold, current.recover_threshold
            ):
                choices.append(current.arm_probe())
            if current.armed_refill_envelopes:
                choices.append(current.execute_refill())
            for successor in choices:
                if not successor.unhealthy:
                    return True
                if successor not in seen:
                    seen.add(successor)
                    nxt.add(successor)
        frontier = nxt
        if not frontier:
            break
    return False


# ---------------------------------------------------------------------------
# Outage runway: closed form checked against outcome-string enumeration.
# ---------------------------------------------------------------------------


def _top_up_to_capacity(state: ReserveProbe, capacity: int) -> ReserveProbe:
    """Best-case governed refill while the flag still permits a new decision."""
    if capacity < state.envelopes:
        raise OracleModelError("capacity below current line balance")
    missing = capacity - state.envelopes
    if not missing:
        return state
    return state.arm_refill(missing).execute_refill()


def max_survivable_outage(
    capacity: int,
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
) -> int:
    """Maximum consecutive failed probe-days followed by only successes.

    This is an optimistic upper bound: after every failure that leaves the
    system healthy, governance immediately tops the line back to ``capacity``.
    On failure ``F`` the flag rises with ``capacity - 1`` envelopes left.  An
    outage of length ``L`` therefore leaves ``capacity - (L - F + 1)`` and
    recovery needs ``R``, giving ``L <= capacity - R + F - 1``.
    """
    _validate_thresholds(fail_threshold, recover_threshold)
    if capacity <= 0:
        raise OracleModelError("capacity must be positive")
    return max(
        fail_threshold - 1,
        capacity - recover_threshold + fail_threshold - 1,
    )


def minimum_capacity_for_outage(
    outage_probe_days: int,
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
) -> int:
    """Smallest first-arm-compliant capacity that survives one outage."""
    if outage_probe_days < 0:
        raise OracleModelError("negative outage")
    _validate_thresholds(fail_threshold, recover_threshold)
    closed_form = outage_probe_days + recover_threshold - fail_threshold + 1
    return max(
        first_arm_runway_envelopes(fail_threshold, recover_threshold),
        closed_form,
    )


def state_after_outage(
    capacity: int,
    outage_probe_days: int,
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
) -> ReserveProbe:
    """Run one outage then ``R`` hypothetical remote successes.

    Healthy-time top-ups are performed after each still-healthy failure.  Once
    unhealthy, no refill is pre-armed; this is the no-in-flight-refill case.
    """
    if outage_probe_days < 0:
        raise OracleModelError("negative outage")
    state = ReserveProbe(capacity, fail_threshold, recover_threshold)
    for _ in range(outage_probe_days):
        state = state.advance(False).state
        if not state.unhealthy:
            state = _top_up_to_capacity(state, capacity)
    for _ in range(recover_threshold):
        state = state.advance(True).state
        if not state.unhealthy:
            break
    return state


@dataclass(frozen=True)
class ExhaustiveOutageResult:
    """Outcome-string audit of :func:`max_survivable_outage`."""

    max_survivable: int
    checked_strings: int
    checked_fresh_outages: int
    counterexamples: tuple[str, ...]


def max_survivable_outage_exhaustive(
    capacity: int,
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
    max_length: int = 16,
) -> ExhaustiveOutageResult:
    """Enumerate every pass/fail string and test every fresh failure run.

    A *fresh* outage is a maximal run of remote failures that begins while the
    reserve state is healthy.  Every healthy prefix is topped back to the same
    capacity, so arbitrary earlier outcome history is included rather than
    assuming the outage starts at genesis.  Each run is followed in a branch
    by ``R`` successes; the branch must recover iff its run length is no larger
    than the closed form.
    """
    closed = max_survivable_outage(capacity, fail_threshold, recover_threshold)
    if max_length < closed + 1:
        raise OracleModelError(
            f"max_length {max_length} must include first failing length {closed + 1}"
        )
    checked_strings = 0
    checked_outages = 0
    observed = -1
    counterexamples: list[str] = []
    initial = ReserveProbe(capacity, fail_threshold, recover_threshold)

    for length in range(max_length + 1):
        for outcomes in product((False, True), repeat=length):
            checked_strings += 1
            states = [initial]
            state = initial
            for passed in outcomes:
                state = state.advance(passed).state
                if not state.unhealthy:
                    state = _top_up_to_capacity(state, capacity)
                states.append(state)

            index = 0
            while index < length:
                if outcomes[index]:
                    index += 1
                    continue
                end = index
                while end < length and not outcomes[end]:
                    end += 1
                if not states[index].unhealthy:
                    checked_outages += 1
                    run_length = end - index
                    recovery = states[end]
                    for _ in range(recover_threshold):
                        recovery = recovery.advance(True).state
                        if not recovery.unhealthy:
                            break
                    survived = not recovery.unhealthy
                    expected = run_length <= closed
                    if survived:
                        observed = max(observed, run_length)
                    if survived != expected and len(counterexamples) < 8:
                        rendered = "".join("P" if value else "F" for value in outcomes)
                        counterexamples.append(
                            f"{rendered}@{index}:{end} expected={expected} got={survived}"
                        )
                index = end

    return ExhaustiveOutageResult(
        max_survivable=observed,
        checked_strings=checked_strings,
        checked_fresh_outages=checked_outages,
        counterexamples=tuple(counterexamples),
    )


# ---------------------------------------------------------------------------
# Exact stationary reserve-health duty cycle (funding deliberately unbounded).
# ---------------------------------------------------------------------------


def unhealthy_duty_cycle(
    failure_probability: Fraction,
    fail_threshold: int = RES_FAIL_THRESHOLD_DEFAULT,
    recover_threshold: int = RES_RECOVER_THRESHOLD_DEFAULT,
) -> Fraction:
    """Stationary fraction of cadence slots in ``ReserveUnhealthy``.

    Healthy periods end on ``F`` consecutive failures and unhealthy periods end
    on ``R`` consecutive passes.  The exact expected waiting time for ``k``
    consecutive Bernoulli events of probability ``x`` is
    ``(1 - x**k) / ((1 - x) * x**k)``.  The renewal-reward ratio
    ``E[unhealthy] / (E[healthy] + E[unhealthy])`` is the stationary duty cycle.
    """
    if not isinstance(failure_probability, Fraction):
        raise OracleModelError("failure probability must be an exact Fraction")
    if not 0 <= failure_probability <= 1:
        raise OracleModelError("failure probability outside [0, 1]")
    _validate_thresholds(fail_threshold, recover_threshold)
    if failure_probability == 0:
        return Fraction(0)
    if failure_probability == 1:
        return Fraction(1)
    p = failure_probability
    q = 1 - p
    healthy_time = (1 - p**fail_threshold) / (q * p**fail_threshold)
    unhealthy_time = (1 - q**recover_threshold) / (p * q**recover_threshold)
    return unhealthy_time / (healthy_time + unhealthy_time)


# ---------------------------------------------------------------------------
# Amendment-time consequence specific to the reserve runway.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReserveThresholds:
    """The two 13 §1 ``u8`` threshold values."""

    fail: int = RES_FAIL_THRESHOLD_DEFAULT
    recover: int = RES_RECOVER_THRESHOLD_DEFAULT

    def __post_init__(self) -> None:
        _validate_thresholds(self.fail, self.recover)

    @property
    def runway_envelopes(self) -> int:
        return self.fail + self.recover

    def amend(self, key: str, value: int) -> "ReserveThresholds":
        """One lawful value amendment; the rows carry no max-Δ.

        Cooldown is temporal and cannot make an in-range value unsafe or safe,
        so this one-step consequence assumes the two-epoch wait has elapsed.
        """
        if key not in {"res.fail_threshold", "res.recover_threshold"}:
            raise OracleModelError(f"unknown reserve threshold key {key!r}")
        _validate_thresholds(value, value)
        field = "fail" if key == "res.fail_threshold" else "recover"
        return replace(self, **{field: value})


@dataclass(frozen=True)
class ThresholdAmendmentFinding:
    """Runway state after an amendment that the stated registry admits."""

    key: str
    value: int
    thresholds: ReserveThresholds
    line_envelopes: int
    required_envelopes: int
    required_micro_usdc: int
    runway_rechecked_by_spec: bool

    @property
    def undercollateralized(self) -> bool:
        return self.line_envelopes < self.required_envelopes


def evaluate_threshold_amendment(
    key: str,
    value: int,
    *,
    live: ReserveThresholds = ReserveThresholds(),
    line_envelopes: int | None = None,
    envelope_micro_usdc: int = probe_envelope_micro_usdc(),
) -> ThresholdAmendmentFinding:
    """Evaluate the 07-specific runway consequence of one lawful amendment.

    Doc 07 says "First arming additionally requires" the relationship; 13 rule
    7 enumerates its amendment-boundary couplings and names no reserve-runway
    screen.  Therefore ``runway_rechecked_by_spec`` is false.  The companion
    :func:`screen_reserve_thresholds` states the check a repair would need.
    """
    amended = live.amend(key, value)
    if line_envelopes is None:
        line_envelopes = live.runway_envelopes
    if line_envelopes < 0:
        raise OracleModelError("negative line balance")
    required = amended.runway_envelopes
    return ThresholdAmendmentFinding(
        key=key,
        value=value,
        thresholds=amended,
        line_envelopes=line_envelopes,
        required_envelopes=required,
        required_micro_usdc=required * envelope_micro_usdc,
        runway_rechecked_by_spec=False,
    )


def screen_reserve_thresholds(
    line_envelopes: int, proposed: ReserveThresholds
) -> bool:
    """The fail-closed amendment screen implied by the first-arm relation."""
    if line_envelopes < 0:
        raise OracleModelError("negative line balance")
    return line_envelopes >= proposed.runway_envelopes


def amendment_findings() -> tuple[Finding, ...]:
    """SQ-554's queryable amendment-boundary defect."""
    finding = evaluate_threshold_amendment(
        "res.recover_threshold", RES_THRESHOLD_MAX
    )
    return (
        Finding(
            "reserve runway rechecked on threshold amendment",
            finding.runway_rechecked_by_spec,
            f"one lawful amendment reaches recover={finding.value}; "
            f"the live default line has {finding.line_envelopes} envelopes "
            f"against {finding.required_envelopes} required",
        ),
    )


# ---------------------------------------------------------------------------
# 07 §4 — watchtower registration, liveness sweep, quorum and exit cost.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, order=True)
class WatchtowerSeat:
    account: str
    entity_ref: str
    stake: int = WT_STAKE_DEFAULT
    inactive_epochs: int = 0

    def __post_init__(self) -> None:
        if not self.account or not self.entity_ref:
            raise OracleModelError("watchtower account and entity are required")
        if self.stake <= 0:
            raise OracleModelError("watchtower stake must be positive")
        if self.inactive_epochs < 0:
            raise OracleModelError("negative inactive epoch count")


@dataclass(frozen=True)
class WatchtowerEjection:
    account: str
    slashed: int
    released: int


@dataclass(frozen=True)
class WatchtowerSet:
    """The §4 set, including the oracle-owned work latch and activity set."""

    seats: tuple[WatchtowerSeat, ...] = ()
    round_existed_latch: bool = False
    open_rounds: int = 0
    active_accounts: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if self.open_rounds < 0:
            raise OracleModelError("negative open-round count")
        if len(self.seats) > WT_MAX:
            raise OracleModelError(f"watchtower set exceeds wt.max={WT_MAX}")
        accounts = [seat.account for seat in self.seats]
        entities = [seat.entity_ref for seat in self.seats]
        if len(accounts) != len(set(accounts)):
            raise OracleModelError("duplicate watchtower account")
        if len(entities) != len(set(entities)):
            raise OracleModelError("two watchtower seats share one entity")
        if tuple(sorted(self.seats)) != self.seats:
            raise OracleModelError("watchtower seats must have stable account order")
        if not self.active_accounts <= set(accounts):
            raise OracleModelError("activity names an unregistered watchtower")

    @property
    def seat_count(self) -> int:
        return len(self.seats)

    def register(
        self,
        account: str,
        entity_ref: str,
        stake: int = WT_STAKE_DEFAULT,
    ) -> "WatchtowerSet":
        """Permissionless-with-stake registration, bounded by ``wt.max``."""
        if self.seat_count >= WT_MAX:
            raise OracleModelError(f"watchtower set is full at wt.max={WT_MAX}")
        if any(seat.account == account for seat in self.seats):
            raise OracleModelError(f"watchtower {account!r} already registered")
        if any(seat.entity_ref == entity_ref for seat in self.seats):
            raise OracleModelError(f"entity {entity_ref!r} already has a seat")
        seats = tuple(sorted(self.seats + (WatchtowerSeat(account, entity_ref, stake),)))
        return replace(self, seats=seats)

    def note_round_opened(self) -> "WatchtowerSet":
        """Set the internal latch when a round is created."""
        return replace(
            self, round_existed_latch=True, open_rounds=self.open_rounds + 1
        )

    def note_round_closed(self) -> "WatchtowerSet":
        """Close one round without erasing the already-set work latch."""
        if self.open_rounds <= 0:
            raise OracleModelError("no open watchtower round to close")
        return replace(self, open_rounds=self.open_rounds - 1)

    def ack(self, account: str) -> "WatchtowerSet":
        """Record activity; a duplicate acknowledgment is an activity no-op."""
        if not any(seat.account == account for seat in self.seats):
            raise OracleModelError(f"watchtower {account!r} is not registered")
        if not self.open_rounds:
            raise OracleModelError("no open round exists to acknowledge")
        return replace(self, active_accounts=self.active_accounts | {account})

    def sweep_liveness(self) -> "WatchtowerSweep":
        """Sweep the most recently ended observed epoch (SQ-491 semantics).

        The caller supplies no ``epoch_had_open_round`` boolean.  Work is the
        oracle-owned ``round existed`` latch OR a round still open now.  A
        swept no-work epoch resets every streak; epochs for which no sweep call
        happens are absent and therefore neither carry nor break one.
        """
        had_work = self.round_existed_latch or self.open_rounds > 0
        kept: list[WatchtowerSeat] = []
        inactive: list[str] = []
        ejected: list[WatchtowerEjection] = []

        for seat in self.seats:
            if not had_work or seat.account in self.active_accounts:
                kept.append(replace(seat, inactive_epochs=0))
                continue
            inactive_epochs = seat.inactive_epochs + 1
            inactive.append(seat.account)
            if inactive_epochs >= WT_INACTIVITY_EPOCHS:
                slash = ceil_div(
                    seat.stake * WT_INACTIVITY_SLASH.numerator,
                    WT_INACTIVITY_SLASH.denominator,
                )
                ejected.append(
                    WatchtowerEjection(
                        account=seat.account,
                        slashed=slash,
                        released=seat.stake - slash,
                    )
                )
            else:
                kept.append(replace(seat, inactive_epochs=inactive_epochs))

        next_set = WatchtowerSet(
            seats=tuple(kept),
            round_existed_latch=False,
            open_rounds=self.open_rounds,
            active_accounts=frozenset(),
        )
        return WatchtowerSweep(
            watchtowers=next_set,
            had_work=had_work,
            marked_inactive=tuple(inactive),
            ejected=tuple(ejected),
        )


@dataclass(frozen=True)
class WatchtowerSweep:
    watchtowers: WatchtowerSet
    had_work: bool
    marked_inactive: tuple[str, ...]
    ejected: tuple[WatchtowerEjection, ...]


@dataclass(frozen=True)
class WatchtowerAttritionRun:
    """A deterministic sequence of one open-and-closed round per epoch."""

    watchtowers: WatchtowerSet
    sweeps: tuple[WatchtowerSweep, ...]
    first_below_quorum_epoch: int | None


def simulate_watchtower_attrition(
    initial: WatchtowerSet,
    acknowledgers_by_epoch: tuple[frozenset[str], ...],
    quorum: int = WT_QUORUM_DEFAULT,
) -> WatchtowerAttritionRun:
    """Run a deterministic inactivity/censorship schedule.

    Each supplied epoch contains one round that opens, receives exactly the
    named acknowledgments, and closes before the liveness sweep.  The returned
    epoch number is one-based, matching the human statement "after two
    consecutive inactive epochs".
    """
    if quorum <= 0:
        raise OracleModelError("quorum must be positive")
    state = initial
    sweeps: list[WatchtowerSweep] = []
    first_below: int | None = None
    for epoch, acknowledgers in enumerate(acknowledgers_by_epoch, start=1):
        state = state.note_round_opened()
        for account in sorted(acknowledgers):
            state = state.ack(account)
        state = state.note_round_closed()
        sweep = state.sweep_liveness()
        sweeps.append(sweep)
        state = sweep.watchtowers
        if first_below is None and not can_finalize_unchallenged(
            state.seat_count, quorum
        ):
            first_below = epoch
    return WatchtowerAttritionRun(state, tuple(sweeps), first_below)


def can_finalize_unchallenged(seats: int, quorum: int) -> bool:
    """Whether all effective seats could supply the required acknowledgments.

    This is a possibility test for an *unchallenged* round.  A challenge
    supersedes the quorum requirement and is outside this predicate.
    """
    if seats < 0 or quorum <= 0:
        raise OracleModelError("seat count must be non-negative and quorum positive")
    return seats >= quorum


def lawful_quorum_amendments(live_quorum: int) -> tuple[int, ...]:
    """Every distinct value reachable in one ``wt.quorum`` amendment."""
    if not WT_QUORUM_MIN <= live_quorum <= WT_QUORUM_MAX:
        raise OracleModelError("live wt.quorum outside its 13 §1 bounds")
    lo = max(WT_QUORUM_MIN, live_quorum - WT_QUORUM_MAX_DELTA)
    hi = min(WT_QUORUM_MAX, live_quorum + WT_QUORUM_MAX_DELTA)
    return tuple(value for value in range(lo, hi + 1) if value != live_quorum)


def first_unsafe_quorum_amendment(
    seats: int, live_quorum: int = WT_QUORUM_DEFAULT
) -> int | None:
    """The first one-step value that makes quorum impossible, if one exists."""
    for proposed in lawful_quorum_amendments(live_quorum):
        if not can_finalize_unchallenged(seats, proposed):
            return proposed
    return None


@dataclass(frozen=True)
class ExitRoute:
    """One route out of the watchtower seat lock."""

    name: str
    specified: bool
    observed_work_epochs: int | None
    cost_usdc: int | None
    released_usdc: int | None
    detail: str


def exit_cost_table(stake: int = WT_STAKE_DEFAULT) -> tuple[ExitRoute, ...]:
    """The §4 exit routes and their computable cost.

    ``guardian recall`` is listed because 07 delegates it, but its cost cannot
    be fabricated: 06 specifies no watchtower recall at all.  Deliberate
    liveness ejection is the only route whose custody disposition is complete.
    """
    if stake <= 0:
        raise OracleModelError("watchtower stake must be positive")
    slash = ceil_div(
        stake * WT_INACTIVITY_SLASH.numerator,
        WT_INACTIVITY_SLASH.denominator,
    )
    return (
        ExitRoute(
            name="guardian recall",
            specified=False,
            observed_work_epochs=None,
            cost_usdc=None,
            released_usdc=None,
            detail="07 §4 delegates recall to 06, which defines no watchtower recall",
        ),
        ExitRoute(
            name="deliberate liveness ejection",
            specified=True,
            observed_work_epochs=WT_INACTIVITY_EPOCHS,
            cost_usdc=slash,
            released_usdc=stake - slash,
            detail="miss two consecutive swept work epochs; slash once by 10%",
        ),
    )


def cheapest_specified_exit(stake: int = WT_STAKE_DEFAULT) -> ExitRoute:
    """The lowest-cost route whose complete custody semantics are specified."""
    routes = [
        route
        for route in exit_cost_table(stake)
        if route.specified and route.cost_usdc is not None
    ]
    if not routes:
        raise OracleModelError("no specified watchtower exit route")
    return min(routes, key=lambda route: (route.cost_usdc, route.name))


def watchtower_findings(
    seats: int = WT_QUORUM_DEFAULT, quorum: int = WT_QUORUM_DEFAULT
) -> tuple[Finding, ...]:
    """Queryable quorum-liveness results at a live seat count."""
    raised = first_unsafe_quorum_amendment(seats, quorum)
    return (
        Finding(
            "watchtower quorum survives one liveness ejection",
            can_finalize_unchallenged(max(0, seats - 1), quorum),
            f"{seats} seats -> {max(0, seats - 1)} after one ejection; quorum={quorum}",
        ),
        Finding(
            "watchtower quorum preserved by every one-step amendment",
            raised is None,
            f"first unsafe one-step wt.quorum value: {raised}",
        ),
    )


# ---------------------------------------------------------------------------
# Cross-document delegations from 07 §4 / §8.
# ---------------------------------------------------------------------------


DOC_07 = "docs/architecture/07-oracle-and-disputes.md"


@dataclass(frozen=True)
class CrossDocumentDelegation:
    """One source claim and the terms that must exist in its target document."""

    key: str
    source_section: int
    source_anchor: str
    target_document: str
    target_terms: tuple[str, ...]


CROSS_DOCUMENT_DELEGATIONS: tuple[CrossDocumentDelegation, ...] = (
    CrossDocumentDelegation(
        "watchtower entity-independence rule",
        4,
        "same entity rule that pins the collator-concentration metric",
        "05-welfare-and-decision-engine.md",
        ("entity_ref", "no two seats per entity"),
    ),
    CrossDocumentDelegation(
        "watchtower recall",
        4,
        "may recall a watchtower via the `guardian` track",
        "06-governance-and-guardians.md",
        ("watchtower",),
    ),
    CrossDocumentDelegation(
        "watchtower censorship threat row",
        4,
        "corrected tm-4 characterization",
        "14-threat-model.md",
        ("th-24", "watchtower"),
    ),
    CrossDocumentDelegation(
        "reserve parameter ownership",
        8,
        "both governed values and their bounds live in",
        "13-parameters.md",
        ("ops.probe_fee_dot", "res.fail_threshold"),
    ),
    CrossDocumentDelegation(
        "reserve funding path",
        8,
        "proves the governed refill path",
        "08-treasury-and-economics.md",
        ("fund_budget_line", "ops.reserve_probe"),
    ),
    CrossDocumentDelegation(
        "reserve unhealthy maintenance debit",
        8,
        "line remains usable while the reserve haircut is active",
        "08-treasury-and-economics.md",
        (
            "one already-funded `ops.reserve_probe` envelope per due probe",
            "fund_budget_line` deliberately remains dispatchable under the flag",
        ),
    ),
    CrossDocumentDelegation(
        "reserve bootstrap-handover migration",
        8,
        "one-way bootstrap-handover migration is owned by",
        "08-treasury-and-economics.md",
        ("treasury storage-v1 migration", "bootstrapopsfundingclosed"),
    ),
    CrossDocumentDelegation(
        "reserve xcm-health composition",
        8,
        "sustained unresponsiveness also degrades `x`",
        "05-welfare-and-decision-engine.md",
        ("reserve health `r`", "c_onchain"),
    ),
    CrossDocumentDelegation(
        "pb-reserve playbook registration",
        8,
        "`pb-reserve` is armed",
        "06-governance-and-guardians.md",
        ("pb-reserve", "ledger.set_split_paused"),
    ),
    CrossDocumentDelegation(
        "reserve nav haircut",
        8,
        "nav reporting and the mark-down rule are economics",
        "08-treasury-and-economics.md",
        ("spendable nav for all new commitments is 0", "reserve_impaired"),
    ),
    CrossDocumentDelegation(
        "reserve frontend surface",
        8,
        "the fe surfaces the flag",
        "10-frontend-architecture.md",
        ("pbreserveactive", "must not report full backing"),
    ),
    CrossDocumentDelegation(
        "reserve recovery review",
        8,
        "mandatory retrospective ratification of the playbook activation",
        "06-governance-and-guardians.md",
        ("mandatory retrospective ratification",),
    ),
)


@dataclass(frozen=True)
class DelegationFinding:
    key: str
    ok: bool
    source_present: bool
    missing_target_terms: tuple[str, ...]
    target_document: str


def architecture_section(text: str, section: int) -> str:
    """Extract one ``## N.`` section without accepting a missing boundary."""
    match = re.search(
        rf"^## {section}\. .*?$(.*?)(?=^## {section + 1}\.|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise OracleModelError(f"07 §{section} not found")
    return match.group(1)


def linked_architecture_documents(repo_root: Path) -> frozenset[str]:
    """Every architecture document linked from 07 §4 and §8."""
    text = (repo_root / DOC_07).read_text(encoding="utf-8")
    linked: set[str] = set()
    for section in (4, 8):
        body = architecture_section(text, section)
        linked.update(
            re.findall(
                r"\]\((?:\./)?((?:0[0-9]|1[0-5])-[^)#]+\.md)(?:#[^)]*)?\)",
                body,
            )
        )
    return frozenset(linked)


def linked_architecture_document_counts(repo_root: Path) -> dict[str, int]:
    """Link-instance count per target, so repeated delegations stay covered."""
    text = (repo_root / DOC_07).read_text(encoding="utf-8")
    counts: dict[str, int] = {}
    for section in (4, 8):
        body = architecture_section(text, section)
        for document in re.findall(
            r"\]\((?:\./)?((?:0[0-9]|1[0-5])-[^)#]+\.md)(?:#[^)]*)?\)",
            body,
        ):
            counts[document] = counts.get(document, 0) + 1
    return dict(sorted(counts.items()))


def declared_delegation_documents() -> frozenset[str]:
    """Target-document coverage of :data:`CROSS_DOCUMENT_DELEGATIONS`."""
    return frozenset(item.target_document for item in CROSS_DOCUMENT_DELEGATIONS)


def declared_delegation_document_counts() -> dict[str, int]:
    """Declaration count per target, compared with the source link instances."""
    counts: dict[str, int] = {}
    for item in CROSS_DOCUMENT_DELEGATIONS:
        counts[item.target_document] = counts.get(item.target_document, 0) + 1
    return dict(sorted(counts.items()))


def documented_oracle_calls(repo_root: Path) -> frozenset[str]:
    """Parse 07 §13's exhaustive ``Calls:`` list into dispatchable names."""
    text = (repo_root / DOC_07).read_text(encoding="utf-8")
    body = architecture_section(text, 13)
    match = re.search(r"Calls: (.*?)\. Hooks:", body, re.DOTALL)
    if match is None:
        raise OracleModelError("07 §13 Calls list not found")
    names: set[str] = set()
    for code in re.findall(r"`([^`]+)`", match.group(1)):
        name = code.split("(", 1)[0]
        if re.fullmatch(r"[a-z][a-z0-9_]*", name):
            names.add(name)
    return frozenset(names)


def check_cross_document_delegations(repo_root: Path) -> tuple[DelegationFinding, ...]:
    """Resolve every declared delegation against the current target text."""
    source = (repo_root / DOC_07).read_text(encoding="utf-8").casefold()
    sections = {
        section: architecture_section(source, section) for section in (4, 8)
    }
    targets: dict[str, str] = {}
    findings: list[DelegationFinding] = []

    for delegation in CROSS_DOCUMENT_DELEGATIONS:
        target = targets.get(delegation.target_document)
        if target is None:
            target = (
                repo_root / "docs" / "architecture" / delegation.target_document
            ).read_text(encoding="utf-8").casefold()
            targets[delegation.target_document] = target
        source_present = delegation.source_anchor.casefold() in sections[
            delegation.source_section
        ]
        missing = tuple(
            term for term in delegation.target_terms if term.casefold() not in target
        )
        findings.append(
            DelegationFinding(
                key=delegation.key,
                ok=source_present and not missing,
                source_present=source_present,
                missing_target_terms=missing,
                target_document=delegation.target_document,
            )
        )
    return tuple(findings)


def unresolved_delegations(repo_root: Path) -> tuple[DelegationFinding, ...]:
    """The structured dangling-reference result, in stable declaration order."""
    return tuple(
        finding
        for finding in check_cross_document_delegations(repo_root)
        if not finding.ok
    )
