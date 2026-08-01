"""09 §3.1, §5.2, §7.1–§7.2 — rollout gates and emergency repair.

Doc 09 publishes a Phase-3 global cap of 2,000,000 USDC, then requires the
Phase-3→4 arming transition to observe the 08 §4.1 PARAM NAV floor of
4,620,989 USDC before that same transition may raise the cap. Executing those
rules yields an upper bound `NAV <= total local USDC issuance <= tvl_cap` and a
2,620,989 USDC shortfall. The cap therefore needs to be at least 4,620,989
USDC before the transition can start. Neither document states that derived
lower bound; both cap defaults remain `[VERIFY]` (SQ-544).

Every escape named during review closes in the specification itself. 08 §1.2
makes every positive NAV term local USDC and subtracts obligations; 09 §5.2
caps *all* local USDC issuance. Genesis contributes only thirteen 0.01-USDC
protocol-account floors, not the 25,000,000-USDC funding target, and those
floors consume issuance headroom rather than create an off-cap NAV term. The
15 try-state rule exempts protocol accounts only from the per-account meter;
09's global issuance cap still binds them. Finally, 09 §5.2 forbids a cap
raise during Phases <= 3 and §7.2 applies the scheduled raise only inside the
transition whose 08 §4.2 NAV gate has already admitted arming. For the wedge
proof :func:`max_attainable_nav` deliberately returns the claimant-favouring
upper bound `tvl_cap`; immovable dust and live obligations can only lower the
real maximum and enlarge the shortfall.

Doc 09 also prices the expedited CODE lane as 72 h gate + 3 d ratification +
24 h timelock floor + 72 h descriptor lead time, publishing approximately
9–10 days. Its own four terms sum to 10 days sequentially or 7 days when the
gate and ratification overlap. More importantly, 05 §3.1 supplies no separate
expedited calendar: submission is confined to Intake and decision remains at
18/21 of the epoch. Sweeping every lawful `epoch.length`, phase-boundary onset
grid, and both the 24 h kernel timelock floor and 7 d CODE registry default
yields a global best of 14 days + 1 block and a global worst of 82 days. At the
21-day default epoch the default timelock yields 25 days + 1 block to 46 days.
No lawful pair reaches the published 9–10-day figure (SQ-545).

The positive D-9 reachability claim also fails. Under PB-LEDGER-FREEZE, 06
§6.3 freezes the mandatory market and T20 force-rejects every live
non-terminal proposal, including Queued and FailedExecuted. Thus no lawful
trace from submission reaches Executed while the freeze remains active. A
source-less staged PB-MIGRATION halt does have a specification trace, because
it leaves ordinary inclusion and markets available; the running runtime still
cannot select it as expedited because its only production queue caller passes
the expedited argument as the literal `false`.

The freeze-renewal parenthetical is true but incomplete: the guardian track's
7-day decision fits in 14 days, while the operative prepare + decision +
confirm + enactment worst case is 1 + 7 + 1 + 2 = 11 days. Guaranteed
submission slack is therefore 3 days, not 7 (and not 4).

Units: money is whole USDC represented by :class:`~decimal.Decimal` at
six-decimal precision; balance searches run in integer micro-USDC. Time is
integer six-second blocks, with exact :class:`~fractions.Fraction` day views.
Gate requirements round up to the next micro-USDC, against the party seeking
to arm the class. Latency adds every stage, so any ambiguity rounds toward a
later repair rather than supporting an unsafe "fits" claim.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_CEILING, localcontext
from fractions import Fraction
from pathlib import Path
from typing import Callable, Iterable

from bleavit_reference_model import lifecycle
from bleavit_reference_model.spec_values import NAV_FLOORS_USDC

WORK_PREC = 60
MICRO_USDC = Decimal(1_000_000)
BLOCKS_PER_DAY = lifecycle.BLOCKS_PER_DAY

# ---------------------------------------------------------------------------
# 13 §1/§2 and 08 §2.5/§4.1 values used by the rollout gates.
# ---------------------------------------------------------------------------

# 13 §1 `phase3.tvl_cap`, sim-gated [VERIFY before Phase-3 arming].
PHASE3_TVL_CAP_DEFAULT = Decimal(2_000_000)
# 13 §1 `phase3.deposit_cap`, sim-gated [VERIFY before Phase-3 arming].
PHASE3_DEPOSIT_CAP_DEFAULT = Decimal(20_000)
# 13 §1: Balance's maximum representable value is the unbounded sentinel.
BALANCE_MAX_BASE_UNITS = 2**128 - 1
_BALANCE_MAX_WHOLE, _BALANCE_MAX_MICRO = divmod(BALANCE_MAX_BASE_UNITS, 1_000_000)
BALANCE_MAX_USDC = Decimal(f"{_BALANCE_MAX_WHOLE}.{_BALANCE_MAX_MICRO:06d}")

# 03 §7 R-4 + 08 §2.1: thirteen accounts, each at USDC min_balance = 10^4
# base units = 0.01 USDC. This is the whole genesis-minted USDC allocation.
USDC_MIN_BALANCE = Decimal("0.01")
GENESIS_PROTOCOL_ACCOUNTS = 13
GENESIS_PROTOCOL_USDC = USDC_MIN_BALANCE * GENESIS_PROTOCOL_ACCOUNTS

# 08 §4.1 frozen literals. They are not live re-derivations.
NAV_FLOORS = NAV_FLOORS_USDC
# 08 §2.5, before Phase-5 TREASURY arming.
TREASURY_FUNDING_TARGET = Decimal(25_000_000)

# 13 §1 `exec.timelock.code`: 7 d default, 24 h kernel floor.
EXEC_TIMELOCK_CODE_FLOOR = BLOCKS_PER_DAY
EXEC_TIMELOCK_CODE_DEFAULT = 7 * BLOCKS_PER_DAY
# 13 §2 `DescriptorLeadTime` = 72 h.
DESCRIPTOR_LEAD_TIME = 3 * BLOCKS_PER_DAY
# 13 §2 PB-LEDGER-FREEZE window and its one-renewal envelope.
FREEZE_WINDOW = 14 * BLOCKS_PER_DAY
FREEZE_RENEWED_ENVELOPE = 2 * FREEZE_WINDOW


class RolloutError(ValueError):
    """A malformed gate or timing input refuses rather than passing open."""


@dataclass(frozen=True)
class Criterion:
    """One 09 §7.1 entry criterion.

    ``reads`` names only 13-registry or 08-owned arithmetic inputs. An empty
    tuple means that the criterion is evidence, deployment state, or a prior
    phase result rather than a numeric 13/08 read.

    ``cap_requirement`` is the least total-local-USDC ceiling compatible with
    the criterion. A NAV floor needs at least its frozen literal; the funding
    target needs at least the amount that must be transferred locally.
    """

    key: str
    text: str
    reads: tuple[str, ...] = ()
    cap_requirement: Decimal | None = None
    nav_floor: Decimal | None = None


@dataclass(frozen=True)
class PhaseGate:
    """One row of 09 §7.1, restricted to its Entry criteria column."""

    phase: int
    name: str
    criteria: tuple[Criterion, ...]


# Every semicolon-delimited entry condition in 09 §7.1 is represented once.
PHASE_GATES: tuple[PhaseGate, ...] = (
    PhaseGate(
        0,
        "Reference & simulation",
        (Criterion("p0.code-complete", "E1–E8 code-complete"),),
    ),
    PhaseGate(
        1,
        "Local nets",
        (Criterion("p1.phase0-exit", "Phase 0 exit"),),
    ),
    PhaseGate(
        2,
        "Public testnet (Paseo) + bounties",
        (
            Criterion("p2.phase1-exit", "Phase 1 exit"),
            Criterion("p2.bounties", "bounty program funded"),
            Criterion("p2.ss58", "ss58 prefix 7777 registry submission accepted"),
            Criterion(
                "p2.bootnodes",
                "testnet WSS bootnode set live (>=8, >=4 operators, >=2 on :443)",
            ),
            Criterion(
                "p2.contract",
                "integration-contract implementation (E15) deployed",
            ),
        ),
    ),
    PhaseGate(
        3,
        "Mainnet shadow futarchy",
        (
            Criterion("p3.audits", "audits A+B passed"),
            Criterion("p3.genesis", "genesis ceremony"),
            Criterion(
                "p3.bootnodes",
                "mainnet WSS bootnodes and 30-day served-state commitment live",
            ),
            Criterion(
                "p3.descriptors",
                "descriptor pipeline live including the Asset Hub descriptor set",
            ),
            Criterion(
                "p3.reporters",
                ">=3 registered oracle reporters with full stakes",
                reads=("orc.n_min", "orc.reporter_stake"),
            ),
            Criterion(
                "p3.hrmp",
                "Asset Hub HRMP channels open and deposit+withdraw test suite passing",
                reads=("phase3.tvl_cap", "phase3.deposit_cap"),
            ),
        ),
    ),
    PhaseGate(
        4,
        "Binding PARAM",
        (
            Criterion("p4.phase3-exit", "Phase 3 exit"),
            Criterion("p4.ratification", "values ratification of the arming upgrade"),
            Criterion(
                "p4.nav-param",
                "spendable NAV >= min-viable NAV(PARAM)",
                reads=("08.nav_floor.param",),
                cap_requirement=NAV_FLOORS["param"],
                nav_floor=NAV_FLOORS["param"],
            ),
        ),
    ),
    PhaseGate(
        5,
        "+ TREASURY",
        (
            Criterion("p5.phase4-exit", "Phase 4 exit"),
            Criterion(
                "p5.v-min",
                "V_min consistently met",
                reads=("dec.v_min.param", "dec.v_min.treasury"),
            ),
            Criterion(
                "p5.funding",
                "treasury funding >= 25,000,000 USDC",
                reads=("08.initial_usdc_funding_target",),
                cap_requirement=TREASURY_FUNDING_TARGET,
            ),
            Criterion(
                "p5.nav-treasury",
                "spendable NAV >= min-viable NAV(TREASURY)",
                reads=("08.nav_floor.treasury",),
                cap_requirement=NAV_FLOORS["treasury"],
                nav_floor=NAV_FLOORS["treasury"],
            ),
        ),
    ),
    PhaseGate(
        6,
        "+ CODE/META",
        (
            Criterion("p6.phase5-exit", "Phase 5 exit"),
            Criterion("p6.audit", "scope-A re-audit"),
            Criterion(
                "p6.nav-code-meta",
                "spendable NAV clears the shared CODE/META arming floor",
                reads=("08.nav_floor.code", "08.nav_floor.meta"),
                cap_requirement=max(NAV_FLOORS["code"], NAV_FLOORS["meta"]),
                nav_floor=max(NAV_FLOORS["code"], NAV_FLOORS["meta"]),
            ),
        ),
    ),
    PhaseGate(
        7,
        "Mature",
        (
            Criterion("p7.phase6-exit", "Phase 6 exit"),
            Criterion("p7.entrenched", "entrenched-track confirmation"),
        ),
    ),
)

PHASE_GATE_BY_NUMBER: dict[int, PhaseGate] = {gate.phase: gate for gate in PHASE_GATES}


@dataclass(frozen=True)
class Finding:
    """One executable specification claim."""

    key: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class CapLink:
    """One link in the SQ-544 NAV/cap/transition argument."""

    key: str
    ok: bool
    detail: str


def cap_argument() -> tuple[CapLink, ...]:
    """The four independent links needed for the SQ-544 wedge proof."""
    return (
        CapLink(
            "nav-local-usdc",
            True,
            "08 §1.2 has only local liquid USDC positive terms; obligations subtract",
        ),
        CapLink(
            "genesis-not-funded",
            GENESIS_PROTOCOL_USDC == Decimal("0.13"),
            "08 §2.1 seeds 13 x 0.01 USDC, while §2.5 transfers funding later",
        ),
        CapLink(
            "protocol-global-cap",
            True,
            "15 exempts protocol accounts from the per-account meter only; "
            "09 §5.2 caps all local issuance",
        ),
        CapLink(
            "gate-before-raise",
            True,
            "09 §5.2 forbids a Phase<=3 raise; §7.2 applies it inside the "
            "already-NAV-gated arming transition",
        ),
    )


def _money(value: Decimal | int) -> Decimal:
    out = value if isinstance(value, Decimal) else Decimal(value)
    if not out.is_finite() or out < 0:
        raise RolloutError(f"invalid non-negative USDC amount {value!r}")
    return out


def _to_base_units(value: Decimal | int) -> int:
    """Round a gate requirement up to micro-USDC, against the arming claimant."""
    amount = _money(value)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return int((amount * MICRO_USDC).to_integral_value(rounding=ROUND_CEILING))


def _from_base_units(value: int) -> Decimal:
    if value < 0 or value > BALANCE_MAX_BASE_UNITS:
        raise RolloutError(f"Balance base units out of range: {value}")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(Decimal(value) / MICRO_USDC)


def max_attainable_nav(tvl_cap: Decimal | int) -> Decimal:
    """The claimant-favouring upper bound on attainable 08 §1.2 NAV.

    Every positive NAV unit is part of total local USDC issuance, while every
    obligation is subtractive. Thus `NAV <= issuance <= tvl_cap`. Returning
    the cap rather than subtracting genesis floors or live obligations gives
    the party seeking arming every possible benefit; failure even at this
    upper bound proves failure in every real state.
    """
    return _money(tvl_cap)


def nav_floor_criteria() -> tuple[tuple[int, Criterion], ...]:
    """Every 09 §7.1 entry criterion that reads an 08 §4.1 NAV floor."""
    return tuple(
        (gate.phase, criterion)
        for gate in PHASE_GATES
        for criterion in gate.criteria
        if criterion.nav_floor is not None
    )


def minimum_cap_for_criterion(criterion: Criterion) -> Decimal:
    """Least global issuance cap compatible with one quantitative criterion."""
    return criterion.cap_requirement or Decimal(0)


def min_tvl_cap_for(phase: int) -> Decimal:
    """Least cap compatible with every cap-sensitive entry criterion in a row."""
    try:
        gate = PHASE_GATE_BY_NUMBER[phase]
    except KeyError as exc:
        raise RolloutError(f"unknown rollout phase {phase}") from exc
    return max(
        (minimum_cap_for_criterion(c) for c in gate.criteria),
        default=Decimal(0),
    )


@dataclass(frozen=True)
class PhaseCapCheck:
    """A phase row evaluated only on its local-USDC/cap constraints."""

    phase: int
    cap: Decimal
    required: Decimal
    shortfall: Decimal

    @property
    def ok(self) -> bool:
        return self.shortfall == 0


def phase_gate_satisfiable(phase: int, tvl_cap: Decimal | int) -> PhaseCapCheck:
    """Whether a cap can accommodate the phase row's numeric USDC criteria.

    This does not pretend that operational evidence criteria have passed. It
    answers the compositional question 09 §7.1 omitted: could the live global
    issuance ceiling possibly coexist with the row's NAV/funding requirements?
    """
    cap = max_attainable_nav(tvl_cap)
    required = min_tvl_cap_for(phase)
    return PhaseCapCheck(phase, cap, required, max(Decimal(0), required - cap))


def sweep_min_tvl_cap_for(
    phase: int,
    *,
    lower: Decimal = PHASE3_TVL_CAP_DEFAULT,
    upper: Decimal = BALANCE_MAX_USDC,
) -> Decimal:
    """Binary-search Balance values for the first cap that clears a phase row.

    The search is monotone and exhaustive over integer micro-USDC between the
    published Phase-3 seed and the 13 §1 unbounded sentinel. It is a search,
    not a direct restatement of the floor.
    """
    low = _to_base_units(lower)
    high = min(_to_base_units(upper), BALANCE_MAX_BASE_UNITS)
    if low > high:
        raise RolloutError("cap sweep lower bound exceeds upper bound")
    if not phase_gate_satisfiable(phase, _from_base_units(high)).ok:
        raise RolloutError(f"phase {phase} cannot clear within Balance")
    while low < high:
        mid = (low + high) // 2
        if phase_gate_satisfiable(phase, _from_base_units(mid)).ok:
            high = mid
        else:
            low = mid + 1
    return _from_base_units(low)


@dataclass(frozen=True)
class PhaseFourTransition:
    """09 §7.2's gate-before-arm-before-cap-raise order."""

    cap_before: Decimal
    requested_cap_after: Decimal
    armed: bool
    cap_after: Decimal
    shortfall: Decimal


PHASE_FOUR_TRANSITION_ORDER = (
    "08 §4.2 PARAM NAV-floor gate",
    "arm PARAM / remove sudo",
    "apply both committed cap raises",
)


def transition_phase_four(
    cap_before: Decimal | int, cap_after: Decimal | int
) -> PhaseFourTransition:
    """Evaluate the published Phase-3→4 transition atomically and fail-static."""
    before = _money(cap_before)
    requested = _money(cap_after)
    check = phase_gate_satisfiable(4, before)
    if not check.ok:
        return PhaseFourTransition(before, requested, False, before, check.shortfall)
    return PhaseFourTransition(before, requested, True, requested, Decimal(0))


def phase_cap_raise_allowed(
    *, phase: int, param_armed: bool, current: Decimal | int, proposed: Decimal | int
) -> bool:
    """09 §5.2: a raise is unavailable in Phases <=3 before PARAM arming."""
    current_value, proposed_value = _money(current), _money(proposed)
    if proposed_value <= current_value:
        return True
    return phase >= 4 and param_armed


# ---------------------------------------------------------------------------
# 05 §3.1 + 09 §3.1 expedited-repair timing.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PublishedSum:
    """The four durations priced by 09 §3.1's published sentence."""

    gate: int
    ratification: int
    timelock: int
    lead_time: int

    @property
    def sequential(self) -> int:
        return self.gate + self.ratification + self.timelock + self.lead_time

    @property
    def concurrent(self) -> int:
        return max(self.gate, self.ratification) + self.timelock + self.lead_time


def published_sum() -> PublishedSum:
    """Re-derive 09 §3.1's own priced total: 10 d sequential / 7 d concurrent."""
    return PublishedSum(
        gate=3 * BLOCKS_PER_DAY,
        ratification=3 * BLOCKS_PER_DAY,
        timelock=EXEC_TIMELOCK_CODE_FLOOR,
        lead_time=DESCRIPTOR_LEAD_TIME,
    )


def expedited_repair_latency(
    epoch_length: int,
    onset: int,
    timelock: int,
    lead_time: int = DESCRIPTOR_LEAD_TIME,
) -> int:
    """Blocks from emergency onset to earliest lawful authorized-code apply.

    The repair can submit in 05 §3.1 Intake `[0, 3/21 L)`. An onset at or
    after the exclusive Intake close waits for the next epoch. Decision stays
    at `18/21 L`; the 72 h gate and expedited ratification run inside that
    ordinary calendar. Authorization then waits the supplied CODE timelock and
    the full descriptor lead time.
    """
    schedule = lifecycle.phase_schedule(epoch_length)
    return _latency_from_schedule(schedule, onset, timelock, lead_time)


def _latency_from_schedule(
    schedule: lifecycle.PhaseSchedule,
    onset: int,
    timelock: int,
    lead_time: int,
) -> int:
    """The timing calculation once lifecycle has derived the phase schedule."""
    epoch_length = schedule.epoch_length
    if not 0 <= onset < epoch_length:
        raise RolloutError(
            f"freeze onset {onset} outside epoch [0, {epoch_length})"
        )
    if timelock < 0 or lead_time < 0:
        raise RolloutError("negative timelock or DescriptorLeadTime")
    intake_close = schedule.boundaries["Qualify"]
    decide = schedule.boundaries["Decide"]
    until_decide = decide - onset if onset < intake_close else epoch_length - onset + decide
    return until_decide + timelock + lead_time


def onset_grid(epoch_length: int) -> tuple[int, ...]:
    """Deterministic phase-boundary grid, including both sides of each edge.

    Latency is affine between boundaries and discontinuous only at the
    exclusive Intake close. Including every boundary and its adjacent blocks
    therefore includes the extrema without iterating every block for all
    19,201 lawful epoch lengths.
    """
    return _onset_grid_from_schedule(lifecycle.phase_schedule(epoch_length))


def _onset_grid_from_schedule(
    schedule: lifecycle.PhaseSchedule,
) -> tuple[int, ...]:
    """Build :func:`onset_grid` without deriving the same schedule twice."""
    epoch_length = schedule.epoch_length
    points = {0, epoch_length - 1}
    for boundary in schedule.boundaries.values():
        for point in (boundary - 1, boundary, boundary + 1):
            if 0 <= point < epoch_length:
                points.add(point)
    return tuple(sorted(points))


@dataclass(frozen=True)
class LatencyCase:
    """One point in the lawful expedited-repair timing sweep."""

    epoch_length: int
    onset: int
    timelock: int
    blocks: int

    @property
    def days(self) -> Fraction:
        return Fraction(self.blocks, BLOCKS_PER_DAY)


@dataclass(frozen=True)
class LatencySweep:
    """Extrema and published-figure reachability over a timing sweep."""

    best: LatencyCase
    worst: LatencyCase
    by_timelock: tuple[tuple[int, LatencyCase, LatencyCase], ...]
    any_published_9_to_10_days: bool


def latency_sweep(
    epoch_lengths: Iterable[int] | None = None,
    timelocks: tuple[int, ...] = (
        EXEC_TIMELOCK_CODE_FLOOR,
        EXEC_TIMELOCK_CODE_DEFAULT,
    ),
) -> LatencySweep:
    """Sweep lawful lengths x phase-edge onset grid x supplied timelocks."""
    lengths = epoch_lengths if epoch_lengths is not None else lifecycle.lawful_epoch_lengths()
    best: LatencyCase | None = None
    worst: LatencyCase | None = None
    per_lock: dict[int, list[LatencyCase | None]] = {
        lock: [None, None] for lock in timelocks
    }
    any_published = False
    saw_length = False
    for epoch_length in lengths:
        saw_length = True
        schedule = lifecycle.phase_schedule(epoch_length)
        for onset in _onset_grid_from_schedule(schedule):
            for timelock in timelocks:
                blocks = _latency_from_schedule(
                    schedule, onset, timelock, DESCRIPTOR_LEAD_TIME
                )
                case = LatencyCase(epoch_length, onset, timelock, blocks)
                if best is None or (case.blocks, case.epoch_length, case.onset, case.timelock) < (
                    best.blocks,
                    best.epoch_length,
                    best.onset,
                    best.timelock,
                ):
                    best = case
                if worst is None or (
                    case.blocks,
                    case.epoch_length,
                    case.onset,
                    case.timelock,
                ) > (
                    worst.blocks,
                    worst.epoch_length,
                    worst.onset,
                    worst.timelock,
                ):
                    worst = case
                lock_best, lock_worst = per_lock[timelock]
                if lock_best is None or case.blocks < lock_best.blocks:
                    per_lock[timelock][0] = case
                if lock_worst is None or case.blocks > lock_worst.blocks:
                    per_lock[timelock][1] = case
                any_published |= 9 * BLOCKS_PER_DAY <= blocks <= 10 * BLOCKS_PER_DAY
    if not saw_length or best is None or worst is None or not timelocks:
        raise RolloutError("empty latency sweep")
    by_timelock = tuple(
        (lock, cases[0], cases[1])  # type: ignore[arg-type]
        for lock, cases in per_lock.items()
    )
    return LatencySweep(best, worst, by_timelock, any_published)


# ---------------------------------------------------------------------------
# 06 §2.1/§6.3 freeze renewal arithmetic.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TrackSchedule:
    """OpenGov track timing in blocks."""

    prepare: int
    decision: int
    confirm: int
    enactment: int


GUARDIAN_TRACK = TrackSchedule(
    prepare=BLOCKS_PER_DAY,
    decision=7 * BLOCKS_PER_DAY,
    confirm=BLOCKS_PER_DAY,
    enactment=2 * BLOCKS_PER_DAY,
)


@dataclass(frozen=True)
class TrackLatency:
    """Earliest and worst-case submission-to-enactment latency."""

    best: int
    worst: int


def track_latency(track: TrackSchedule) -> TrackLatency:
    """Best excludes decision dwell; worst counts every published stage."""
    values = (track.prepare, track.decision, track.confirm, track.enactment)
    if any(value < 0 for value in values):
        raise RolloutError("negative track duration")
    return TrackLatency(
        best=track.prepare + track.confirm + track.enactment,
        worst=sum(values),
    )


def renewal_slack(
    window: int = FREEZE_WINDOW, track: TrackSchedule = GUARDIAN_TRACK
) -> int:
    """Latest worst-case submission offset that still fits the first window."""
    if window < 0:
        raise RolloutError("negative freeze window")
    return window - track_latency(track).worst


def renewal_fits_first_window(
    submission_offset: int,
    *,
    window: int = FREEZE_WINDOW,
    track: TrackSchedule = GUARDIAN_TRACK,
) -> bool:
    """Whether worst-case enactment lands no later than first expiry."""
    if submission_offset < 0:
        raise RolloutError("negative renewal submission offset")
    return submission_offset + track_latency(track).worst <= window


# ---------------------------------------------------------------------------
# Guarded lifecycle reachability under 06 §6.3 and 09 §3.1.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Env:
    """Emergency and rollout state read by guarded lifecycle transitions."""

    ledger_frozen: bool
    dead_man: bool
    migration_halt: bool
    expedited: bool
    phase: int

    @property
    def emergency_active(self) -> bool:
        return self.ledger_frozen or self.migration_halt

    @property
    def code_lane_available(self) -> bool:
        # 09 §7.1: all classes are testnet-binding in Phase 2; production
        # CODE/META first bind together in Phase 6. Phase 3 is advisory and its
        # guard is disconnected; Phases 4–5 do not arm CODE.
        return self.phase == 2 or self.phase >= 6


TransitionPredicate = Callable[[Env], bool]


@dataclass(frozen=True)
class GuardedTransition:
    """One lifecycle transition paired with its emergency predicate."""

    transition: lifecycle.Transition
    guard: str
    predicate: TransitionPredicate = field(compare=False, repr=False)


def _submission_guard(env: Env) -> bool:
    if env.dead_man:
        return False
    if not env.expedited:
        return True
    return env.code_lane_available and env.emergency_active


def _ordinary_guard(env: Env) -> bool:
    if env.dead_man or env.ledger_frozen:
        return False
    if env.expedited:
        return env.code_lane_available and env.emergency_active
    return True


def _decide_guard(env: Env) -> bool:
    # 09 §3.1 re-checks emergency admissibility at decide.
    return _ordinary_guard(env) and (not env.expedited or env.emergency_active)


def _execute_guard(env: Env) -> bool:
    if env.dead_man or not env.code_lane_available:
        return False
    if env.expedited:
        # 09 §3.1 exempts the triggering freeze/halt only at guard item 10.
        return env.emergency_active
    return not env.ledger_frozen and not env.migration_halt


def _freeze_reject_guard(env: Env) -> bool:
    return env.ledger_frozen


def _settlement_guard(env: Env) -> bool:
    # 06 §6.3 deliberately leaves settlement live under PB-LEDGER-FREEZE.
    return not env.dead_man


_GUARDS_BY_TAG: dict[str, tuple[str, TransitionPredicate]] = {
    "T1": ("submission; expedited requires a live trigger and CODE phase", _submission_guard),
    "T8": ("decide-time emergency re-check", _decide_guard),
    "T9": ("decide-time emergency re-check", _decide_guard),
    "T10": ("decide-time emergency re-check", _decide_guard),
    "T14": ("execution item 10 expedited exemption", _execute_guard),
    "T17": ("settlement remains live", _settlement_guard),
    "T19": ("settlement remains live", _settlement_guard),
    "T20": ("PB-LEDGER-FREEZE force rejection", _freeze_reject_guard),
    "T21": ("settlement remains live", _settlement_guard),
    "T23": ("execution item 10 expedited exemption", _execute_guard),
}


def _guard_for(transition: lifecycle.Transition) -> tuple[str, TransitionPredicate]:
    return _GUARDS_BY_TAG.get(
        transition.tag,
        ("ordinary lifecycle progress; freeze/dead-man blocks", _ordinary_guard),
    )


GUARDED_TRANSITIONS: tuple[GuardedTransition, ...] = tuple(
    GuardedTransition(transition, *_guard_for(transition))
    for transition in lifecycle.TRANSITIONS
)
GUARDED_BY_TAG: dict[str, GuardedTransition] = {
    guarded.transition.tag: guarded for guarded in GUARDED_TRANSITIONS
}


def guarded_enabled(
    config: lifecycle.Config, env: Env
) -> tuple[lifecycle.Transition, ...]:
    """Every §2.1 transition enabled after applying emergency predicates."""
    return tuple(
        transition
        for transition in lifecycle.enabled(config)
        if GUARDED_BY_TAG[transition.tag].predicate(env)
    )


def guarded_reachable_configs(
    env: Env, start: lifecycle.Config | None = None
) -> set[lifecycle.Config]:
    """Reachability closure under one fixed emergency environment."""
    start = start or lifecycle.Config("None")
    seen, frontier = {start}, [start]
    while frontier:
        config = frontier.pop()
        for transition in guarded_enabled(config, env):
            nxt = lifecycle.fire(config, transition)
            if nxt not in seen:
                seen.add(nxt)
                frontier.append(nxt)
    return seen


def guarded_reaches(
    env: Env, target_state: str, start: lifecycle.Config | None = None
) -> bool:
    """The positive reachability question used by D-9's repair claim."""
    return any(
        config.state == target_state
        for config in guarded_reachable_configs(env, start)
    )


def freeze_repair_finding(env: Env | None = None) -> Finding:
    """SQ-545's positive claim: some active-freeze trace reaches Executed."""
    environment = env or Env(
        ledger_frozen=True,
        dead_man=False,
        migration_halt=False,
        expedited=True,
        phase=6,
    )
    reaches_executed = guarded_reaches(environment, "Executed")
    return Finding(
        "expedited.freeze-reaches-executed",
        reaches_executed,
        "D-9 requires a repair trace under PB-LEDGER-FREEZE; T20 reaches "
        "Rejected before the queue and frozen markets cannot produce a decision",
    )


# ---------------------------------------------------------------------------
# Live implementation audit: is any production caller able to set expedited?
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProductionWriterCheck:
    """Last arguments at production calls to the sole queue writer."""

    last_arguments: tuple[str, ...]

    @property
    def call_count(self) -> int:
        return len(self.last_arguments)

    @property
    def can_mark_expedited(self) -> bool:
        return any(argument != "false" for argument in self.last_arguments)


def _balanced_calls(text: str, needle: str) -> tuple[str, ...]:
    """Extract call interiors for a Rust path, respecting nested delimiters."""
    calls: list[str] = []
    cursor = 0
    while True:
        start = text.find(needle, cursor)
        if start < 0:
            break
        open_paren = start + len(needle) - 1
        depth = 0
        in_string = False
        escaped = False
        for index in range(open_paren, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    calls.append(text[open_paren + 1 : index])
                    cursor = index + 1
                    break
        else:
            raise RolloutError(f"unterminated Rust call {needle}")
    return tuple(calls)


def _top_level_arguments(call: str) -> tuple[str, ...]:
    parts: list[str] = []
    start = 0
    depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(call):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(call[start:index].strip())
            start = index + 1
    tail = call[start:].strip()
    if tail:
        parts.append(tail)
    return tuple(parts)


def production_expedited_writer(repo_root: Path) -> ProductionWriterCheck:
    """Inspect only the runtime's production Epoch→ExecutionGuard adapter.

    Benchmarks and pallet mocks are deliberately outside the extracted impl.
    This audit is not part of the independent arithmetic derivation; it answers
    the brief's separate question whether the specification lane has a live
    writer in the shipped runtime.
    """
    path = repo_root / "runtime/bleavit-runtime/src/configs.rs"
    text = path.read_text(encoding="utf-8")
    start_marker = (
        "impl pallet_epoch::ExecutionGuardAccess for RuntimeEpochExecutionGuard {"
    )
    end_marker = "pub struct ExecutionParams;"
    try:
        production = text.split(start_marker, 1)[1].split(end_marker, 1)[0]
    except IndexError as exc:
        raise RolloutError("production ExecutionGuardAccess impl not found") from exc
    calls = _balanced_calls(production, "crate::ExecutionGuard::enqueue(")
    last_arguments = []
    for call in calls:
        arguments = _top_level_arguments(call)
        if not arguments:
            raise RolloutError("production enqueue call has no arguments")
        last_arguments.append(re.sub(r"\s+", " ", arguments[-1]).strip())
    return ProductionWriterCheck(tuple(last_arguments))


def rollout_findings() -> tuple[Finding, ...]:
    """The arithmetic/specification findings, in document order."""
    cap = phase_gate_satisfiable(4, PHASE3_TVL_CAP_DEFAULT)
    timing = latency_sweep()
    renewal = track_latency(GUARDIAN_TRACK)
    return (
        Finding(
            "phase4.nav-cap",
            cap.ok,
            f"cap {cap.cap} vs PARAM floor {cap.required}; shortfall {cap.shortfall}",
        ),
        Finding(
            "expedited.published-latency",
            timing.any_published_9_to_10_days,
            f"best {timing.best.blocks} blocks; worst {timing.worst.blocks} blocks",
        ),
        freeze_repair_finding(),
        Finding(
            "freeze.renewal-fits",
            renewal.worst <= FREEZE_WINDOW,
            f"worst {renewal.worst} blocks; submission slack {renewal_slack()} blocks",
        ),
    )
