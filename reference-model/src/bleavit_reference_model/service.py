"""16 §4–§6.4 — independent executable model of the hosted-question core.

The service sells a sealed report and a conservative manipulation-cost claim;
settlement is a later, client-trust-domain operation.  This module derives the
state graph, cash-cost formula, liquidity requirement, filing-bond coverage,
and attestor median directly from docs 16, 05 and 04.  It deliberately shares
no implementation with ``question-service-core``.

All monetary arithmetic is ``Decimal`` at 100-digit precision (about 332 bits)
and crosses the USDC boundary only by explicit directional rounding.  In
particular, ``C_disp`` is 04 §3's LMSR *cash cost*, never its share
displacement.  There is intentionally no epsilon-feasibility ceiling: 16 §5.1
deletes that claim because the real backward-crediting slew accumulator does
not make it an upper bound.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext
from enum import Enum
from typing import Sequence

WORK_PREC = 100
USDC_BASE_UNIT = Decimal("0.000001")
# 05 §4.4: every settled component value lies on the 1e9 grid.
SCORE_GRID = Decimal("0.000000001")
ONE = Decimal(1)
HALF = Decimal("0.5")
BPS_DENOMINATOR = 10_000
USDC_SCALE = 1_000_000
PROVENANCE_DOMAIN = b"bleavit/hosted-report/v1"

# 13 §2 / 16 §5–§6.3 kernel and reused values.  There is no service-
# specific security multiplier.
SECURITY_FACTOR = 3
SVC_ATTESTORS_MIN = 3
REG_BOND_MILESTONE = Decimal(2_500)
ORC_ROUNDS_DEFAULT = 3
ORC_ROUNDS_MAX = 4
ORC_BOND_BPS_DEFAULT = 250
ORC_BOND_BPS_MAX = 1_000


class ServiceModelError(ValueError):
    """An invalid input refuses instead of producing a security claim."""


class QuestionState(str, Enum):
    REGISTERED = "Registered"
    OPEN = "Open"
    SEALED = "Sealed"
    SETTLED = "Settled"
    VOIDED = "Voided"


class VoidReason(str, Enum):
    NO_QUORUM = "NoQuorum"
    MEDIAN_OUT_OF_RANGE = "MedianOutOfRange"
    DEADLINE_MISSED = "DeadlineMissed"
    SERVICE_PAUSED = "ServicePaused"
    ESCROW_INSUFFICIENT = "EscrowInsufficient"
    ATTESTOR_SET_COLLAPSED = "AttestorSetCollapsed"
    CLIENT_UNREACHABLE = "ClientUnreachable"


class ServiceError(str, Enum):
    """The distinct integration errors frozen by architecture 16 §11."""

    NOT_REGISTERED = "NotRegistered"
    CLIENT_REMOVED = "ClientRemoved"
    SERVICE_PAUSED = "ServicePaused"
    SERVICE_RATE_UNSET = "ServiceRateUnset"
    CERTIFICATION_UNAVAILABLE = "CertificationUnavailable"
    STAKE_BELOW_FLOOR = "StakeBelowFloor"
    SUBSIDY_BELOW_MINIMUM = "SubsidyBelowMinimum"
    EPSILON_OUT_OF_RANGE = "EpsilonOutOfRange"
    WINDOW_TOO_LONG = "WindowTooLong"
    WINDOW_TOO_SHORT = "WindowTooShort"
    WINDOW_COLLIDES_WITH_DECISION = "WindowCollidesWithDecision"
    SLOTS_EXHAUSTED = "SlotsExhausted"
    TVL_CAP_WOULD_BIND = "TvlCapWouldBind"
    ATTESTOR_SET_TOO_SMALL = "AttestorSetTooSmall"
    ATTESTOR_BOND_INSUFFICIENT = "AttestorBondInsufficient"
    CLIENT_IS_PROTOCOL_ACCOUNT = "ClientIsProtocolAccount"
    ESCROW_INSUFFICIENT = "EscrowInsufficient"
    NOT_SEALED = "NotSealed"
    ALREADY_SEALED = "AlreadySealed"
    ALREADY_TERMINAL = "AlreadyTerminal"
    QUORUM_NOT_REACHED = "QuorumNotReached"
    MEDIAN_OUT_OF_RANGE = "MedianOutOfRange"
    DEADLINE_NOT_REACHED = "DeadlineNotReached"
    UNKNOWN_QUESTION = "UnknownQuestion"
    DEADLINE_PASSED = "DeadlinePassed"
    CREATION_FROZEN = "CreationFrozen"
    DUPLICATE_ATTESTOR = "DuplicateAttestor"
    UNKNOWN_ATTESTOR = "UnknownAttestor"
    ALREADY_BONDED = "AlreadyBonded"
    INVALID_SUB_ID = "InvalidSubId"
    ARITHMETIC_OVERFLOW = "ArithmeticOverflow"
    ARCHIVE_NOT_READY = "ArchiveNotReady"
    TRY_STATE_VIOLATION = "TryStateViolation"


# 16 §4's complete graph.  Carrying it as data makes "only two terminals"
# and "no stranded non-terminal" executable properties rather than comments.
SUCCESS_EDGE: dict[QuestionState, QuestionState] = {
    QuestionState.REGISTERED: QuestionState.OPEN,
    QuestionState.OPEN: QuestionState.SEALED,
    QuestionState.SEALED: QuestionState.SETTLED,
}
VOIDABLE_STATES = frozenset(SUCCESS_EDGE)
TERMINAL_STATES = frozenset({QuestionState.SETTLED, QuestionState.VOIDED})


def outgoing_states(state: QuestionState) -> frozenset[QuestionState]:
    """Every non-terminal has one explicit success edge and one VOID edge."""
    if state in TERMINAL_STATES:
        return frozenset()
    try:
        success = SUCCESS_EDGE[state]
    except KeyError as exc:
        raise ServiceModelError(f"unknown question state {state!r}") from exc
    return frozenset({success, QuestionState.VOIDED})


def _d(value: Decimal | int | str) -> Decimal:
    # Only exact constructors are admitted; approximate numeric objects would
    # silently import their representation error into a security figure.
    if not isinstance(value, (Decimal, int, str)):
        raise TypeError("inputs must be Decimal, integer, or decimal strings")
    return value if isinstance(value, Decimal) else Decimal(value)


def _round_usdc_down(value: Decimal) -> Decimal:
    return value.quantize(USDC_BASE_UNIT, rounding=ROUND_FLOOR)


def _round_usdc_up(value: Decimal) -> Decimal:
    return value.quantize(USDC_BASE_UNIT, rounding=ROUND_CEILING)


@dataclass(frozen=True)
class ManipulationBook:
    """One book and the pre-move price of the outcome the attacker buys."""

    b: Decimal
    bought_outcome_twap: Decimal


def _cash_displacement_cost(book: ManipulationBook, epsilon: Decimal) -> Decimal:
    """04 §3 cash cost ``b·ln((1-p)/(1-p-epsilon))``."""
    b = _d(book.b)
    price = _d(book.bought_outcome_twap)
    if b <= 0:
        raise ServiceModelError("book liquidity must be positive")
    if not Decimal(0) < price < ONE - epsilon:
        raise ServiceModelError("displacement leaves the probability domain")
    return b * ((ONE - price) / (ONE - price - epsilon)).ln()


def _manipulation_components(
    books: Sequence[ManipulationBook],
    epsilon: Decimal | int | str,
    contest_capital: Decimal | int | str,
    flow_cap: Decimal | int | str,
) -> tuple[Decimal, Decimal]:
    """Return unrounded ``(C_disp, C_hold)`` after validating the sold inputs.

    A hosted question has exactly two books.  The ACCEPT input is its LONG
    TWAP; the REJECT input is its SHORT price, ``1 - twap_reject``.
    """
    epsilon = _d(epsilon)
    contest_capital = _d(contest_capital)
    flow_cap = _d(flow_cap)
    if len(books) != 2:
        raise ServiceModelError("a hosted question has exactly two books")
    if not Decimal(0) < epsilon < ONE:
        raise ServiceModelError("epsilon is outside (0, 1)")
    if contest_capital < 0 or flow_cap < 0:
        raise ServiceModelError("capital inputs must be non-negative")

    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        c_disp = sum(
            (_cash_displacement_cost(book, epsilon) for book in books),
            start=Decimal(0),
        )
        total_b = sum((_d(book.b) for book in books), start=Decimal(0))
        c_hold = min(contest_capital, flow_cap * total_b) * epsilon
        return c_disp, c_hold


def displacement_floor(
    books: Sequence[ManipulationBook], epsilon: Decimal | int | str
) -> Decimal:
    """16 §5.2's certificate input ``C_disp``, rounded down to µUSDC."""
    c_disp, _ = _manipulation_components(books, epsilon, 0, 0)
    return _round_usdc_down(c_disp)


def manip_floor(
    books: Sequence[ManipulationBook],
    epsilon: Decimal | int | str,
    contest_capital: Decimal | int | str,
    flow_cap: Decimal | int | str,
) -> Decimal:
    """16 §5.1's published ``C_disp + C_hold``, rounded down to µUSDC."""
    c_disp, c_hold = _manipulation_components(
        books, epsilon, contest_capital, flow_cap
    )
    return _round_usdc_down(c_disp + c_hold)


def b_min_multiple(epsilon: Decimal | int | str) -> Decimal:
    """The exact high-precision multiplier before USDC-base-unit rounding."""
    epsilon = _d(epsilon)
    if not Decimal(0) < epsilon < HALF:
        raise ServiceModelError("epsilon is outside (0, 0.5)")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return Decimal(SECURITY_FACTOR) / (
            Decimal(2) * (HALF / (HALF - epsilon)).ln()
        )


def b_min(stake: Decimal | int | str, epsilon: Decimal | int | str) -> Decimal:
    """16 §5.2 minimum equal per-book liquidity, rounded up to µUSDC."""
    stake = _d(stake)
    if stake < 0:
        raise ServiceModelError("declared stake must be non-negative")
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return _round_usdc_up(stake * b_min_multiple(epsilon))


def certified(displacement: Decimal, declared_stake: Decimal) -> bool:
    """The sold relation, not an unqualified badge (16 §5.2)."""
    floor = _d(displacement)
    stake = _d(declared_stake)
    if floor < 0 or stake < 0:
        raise ServiceModelError("certificate inputs must be non-negative")
    return floor >= SECURITY_FACTOR * stake


def quorum(attestor_count: int) -> int:
    """16 §6.3's ``ceil(n/2)`` after the immutable ``n >= 3`` floor."""
    if attestor_count < SVC_ATTESTORS_MIN:
        raise ServiceModelError("attestor set is below the kernel floor")
    return (attestor_count + 1) // 2


@dataclass(frozen=True)
class AttestorMedian:
    value: Decimal
    quorum: int
    tolerance: Decimal
    within_tolerance: tuple[bool, ...]

    @property
    def slashable_indices(self) -> tuple[int, ...]:
        """Submitters beyond tolerance; the boundary itself is not beyond it."""
        return tuple(
            index for index, within in enumerate(self.within_tolerance) if not within
        )


@dataclass(frozen=True)
class AttestorReport:
    """One settlement value bound to its named attestor identity."""

    attestor: bytes
    value: Decimal


def attestor_median(
    named_attestors: Sequence[bytes],
    reports: Sequence[AttestorReport],
    tolerance: Decimal | int | str,
) -> AttestorMedian:
    """Median of the submitted quorum and each submitter's slash classification.

    More than the minimum quorum may participate, but never more than the named
    set.  For an even submitted quorum, the ordinary midpoint is exact Decimal
    arithmetic.  One deviant does not veto an otherwise in-range median; its
    deviation is instead exposed for 16 §6.3's 40/60 slash path.
    """
    named = tuple(named_attestors)
    required = quorum(len(named))
    tolerance = _d(tolerance)
    if len(set(named)) != len(named):
        raise ServiceModelError("attestors must be distinct")
    if not Decimal(0) <= tolerance <= ONE:
        raise ServiceModelError("tolerance is outside [0, 1]")
    submitters = tuple(report.attestor for report in reports)
    if any(attestor not in named for attestor in submitters):
        raise ServiceModelError("report came from an unnamed attestor")

    # 16 §6.3 ruling (2): repeats collapse to each attestor's LATEST rather
    # than poisoning the set — otherwise one named attestor forces a VOID by
    # correcting its own value. Quorum is then counted over DISTINCT attestors,
    # and that ordering is load-bearing: counting the raw slice would let a
    # single attestor satisfy a quorum of two by submitting twice, which is the
    # exact property the quorum exists to deny.
    latest: dict = {}
    for report in reports:
        latest[report.attestor] = _d(report.value)
    if len(latest) > len(named):
        raise ServiceModelError("more distinct attestors than named")
    if len(latest) < required:
        raise ServiceModelError("quorum not reached")
    values = tuple(latest.values())

    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        value = ordered[middle]
    else:
        # 16 §6.3 ruling (1): an even quorum settles on the arithmetic mean of
        # the two central values, **floored to 05 §4.4's 1e9 grid**. The
        # dispositive reason is not rounding direction — it is that an
        # unfloored mean is not a representable settlement value at all, so an
        # "independent" model that returned one would certify behaviour the
        # chain cannot express, and could classify a submission inside or
        # outside tolerance at the boundary differently from the runtime.
        value = ((ordered[middle - 1] + ordered[middle]) / Decimal(2)).quantize(
            SCORE_GRID, rounding=ROUND_FLOOR
        )
    if not Decimal(0) <= value <= ONE:
        raise ServiceModelError("median is outside [0, 1]")

    checks = tuple(abs(reported - value) <= tolerance for reported in values)
    return AttestorMedian(value, required, tolerance, checks)


def coverage_bps(rounds: int, bond_bps: int) -> int:
    """The geometric ladder's terminal coverage rate in basis points."""
    if rounds < 1 or bond_bps < 0:
        raise ServiceModelError("invalid bond ladder")
    return (2**rounds - 1) * bond_bps


def minimum_bond_bps(required_coverage_bps: int, rounds: int) -> int:
    """Smallest integer rate whose complete ladder covers the requirement."""
    if required_coverage_bps < 0 or rounds < 1:
        raise ServiceModelError("invalid coverage requirement")
    multiplier = 2**rounds - 1
    return -(-required_coverage_bps // multiplier)


def settlement_bond(
    escrowed: Decimal | int | str,
    *,
    rounds: int = ORC_ROUNDS_DEFAULT,
    bond_bps: int = ORC_BOND_BPS_DEFAULT,
    floor: Decimal | int | str = REG_BOND_MILESTONE,
) -> Decimal:
    """16 §6.3's terminal-stack-equivalent filing bond, rounded up."""
    escrowed = _d(escrowed)
    floor = _d(floor)
    if escrowed < 0 or floor < 0:
        raise ServiceModelError("bond inputs must be non-negative")
    rate = coverage_bps(rounds, bond_bps)
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        scaled = _round_usdc_up(Decimal(rate) * escrowed / BPS_DENOMINATOR)
        return max(floor, scaled)


@dataclass(frozen=True)
class SettlementTrust:
    attestors: tuple[bytes, ...]
    quorum: int
    bond_total: Decimal

    @classmethod
    def from_attestors(
        cls, attestors: Sequence[bytes], bond_total: Decimal | int | str
    ) -> "SettlementTrust":
        named = tuple(attestors)
        if len(set(named)) != len(named):
            raise ServiceModelError("attestors must be distinct")
        bond = _d(bond_total)
        if bond < 0:
            raise ServiceModelError("bond total must be non-negative")
        return cls(named, quorum(len(named)), bond)


@dataclass(frozen=True)
class ReportDraft:
    question_id: int
    client_id: int
    sub_id: bytes
    twap_accept_1e9: int
    twap_reject_1e9: int
    observations: int
    window_start: int
    window_end: int
    b_accept: Decimal
    b_reject: Decimal
    declared_stake: Decimal
    epsilon_1e9: int
    tolerance_1e9: int
    settlement_trust: SettlementTrust


@dataclass(frozen=True)
class Report:
    """16 §5's report in normative field order."""

    question_id: int
    client_id: int
    sub_id: bytes
    twap_accept_1e9: int
    twap_reject_1e9: int
    observations: int
    window_start: int
    window_end: int
    b_accept: Decimal
    b_reject: Decimal
    manip_floor: Decimal
    declared_stake: Decimal
    epsilon_1e9: int
    tolerance_1e9: int
    certified: bool
    settlement_trust: SettlementTrust
    provenance_hash: bytes

    def provenance_fields(self) -> tuple[object, ...]:
        """The exact public `ReportView` projection before ``provenance_hash``."""
        return (
            self.question_id,
            self.client_id,
            self.sub_id,
            self.twap_accept_1e9,
            self.twap_reject_1e9,
            self.observations,
            self.window_start,
            self.window_end,
            self.b_accept,
            self.b_reject,
            self.manip_floor,
            self.declared_stake,
            self.epsilon_1e9,
            self.tolerance_1e9,
            self.certified,
            (
                len(self.settlement_trust.attestors),
                self.settlement_trust.quorum,
                self.settlement_trust.bond_total,
            ),
        )

    def provenance_preimage(self) -> bytes:
        """Domain-separated SCALE preimage frozen by 16 §5.2."""
        return report_provenance_preimage(self)

    def verifies(self) -> bool:
        return provenance_hash(self) == self.provenance_hash


def _scale_uint(value: int, width: int, field: str) -> bytes:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ServiceModelError(f"{field} must be an integer")
    if value < 0 or value >= 1 << (width * 8):
        raise ServiceModelError(f"{field} exceeds SCALE u{width * 8}")
    return value.to_bytes(width, "little")


def _scale_balance(value: Decimal | int | str, field: str) -> bytes:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        scaled = _d(value) * USDC_SCALE
        integral = scaled.to_integral_value()
    if scaled != integral:
        raise ServiceModelError(f"{field} is not representable in USDC base units")
    return _scale_uint(int(integral), 16, field)


def report_provenance_preimage(report: Report) -> bytes:
    """Independently encode ``PROVENANCE_DOMAIN || SCALE(fields)``.

    Every field is fixed-width in the frozen ``ReportView``. The settlement
    trust projection commits the public attestor count, not their identities.
    """
    if not isinstance(report.sub_id, bytes) or len(report.sub_id) != 32:
        raise ServiceModelError("sub_id must be exactly 32 bytes")
    trust = report.settlement_trust
    return b"".join(
        (
            PROVENANCE_DOMAIN,
            _scale_uint(report.question_id, 8, "question_id"),
            _scale_uint(report.client_id, 4, "client_id"),
            report.sub_id,
            _scale_uint(report.twap_accept_1e9, 8, "twap_accept_1e9"),
            _scale_uint(report.twap_reject_1e9, 8, "twap_reject_1e9"),
            _scale_uint(report.observations, 4, "observations"),
            _scale_uint(report.window_start, 4, "window_start"),
            _scale_uint(report.window_end, 4, "window_end"),
            _scale_balance(report.b_accept, "b_accept"),
            _scale_balance(report.b_reject, "b_reject"),
            _scale_balance(report.manip_floor, "manip_floor"),
            _scale_balance(report.declared_stake, "declared_stake"),
            _scale_uint(report.epsilon_1e9, 8, "epsilon_1e9"),
            _scale_uint(report.tolerance_1e9, 8, "tolerance_1e9"),
            b"\x01" if report.certified else b"\x00",
            _scale_uint(len(trust.attestors), 4, "attestors"),
            _scale_uint(trust.quorum, 4, "quorum"),
            _scale_balance(trust.bond_total, "bond_total"),
        )
    )


def provenance_hash(report: Report) -> bytes:
    """Substrate's ``blake2_256`` over the normative provenance preimage."""
    return hashlib.blake2b(report_provenance_preimage(report), digest_size=32).digest()


def assemble_report(
    draft: ReportDraft,
    contest_capital: Decimal | int | str,
    flow_cap: Decimal | int | str,
) -> Report:
    """Fill 16 §5's derived report fields from the sealed observations."""
    scale = Decimal(1_000_000_000)
    accept_long = Decimal(draft.twap_accept_1e9) / scale
    reject_short = ONE - Decimal(draft.twap_reject_1e9) / scale
    epsilon = Decimal(draft.epsilon_1e9) / scale
    books = (
        ManipulationBook(_d(draft.b_accept), accept_long),
        ManipulationBook(_d(draft.b_reject), reject_short),
    )
    floor = manip_floor(
        books,
        epsilon,
        contest_capital,
        flow_cap,
    )
    report = Report(
        draft.question_id,
        draft.client_id,
        draft.sub_id,
        draft.twap_accept_1e9,
        draft.twap_reject_1e9,
        draft.observations,
        draft.window_start,
        draft.window_end,
        _d(draft.b_accept),
        _d(draft.b_reject),
        floor,
        _d(draft.declared_stake),
        draft.epsilon_1e9,
        draft.tolerance_1e9,
        certified(displacement_floor(books, epsilon), _d(draft.declared_stake)),
        draft.settlement_trust,
        b"",
    )
    return replace(report, provenance_hash=provenance_hash(report))


@dataclass(frozen=True)
class Question:
    """Data-driven lifecycle witness, independent of Rust's typestate shape."""

    question_id: int
    state: QuestionState = QuestionState.REGISTERED
    report: Report | None = None
    settlement: AttestorMedian | None = None
    void_reason: VoidReason | None = None

    def advance(
        self,
        *,
        report: Report | None = None,
        settlement: AttestorMedian | None = None,
    ) -> "Question":
        """Take the state's sole explicit success edge."""
        if self.state in TERMINAL_STATES:
            raise ServiceModelError("a terminal question has no outgoing edge")
        target = SUCCESS_EDGE[self.state]
        if target is QuestionState.OPEN:
            if report is not None or settlement is not None:
                raise ServiceModelError("opening consumes no report or settlement")
            return replace(self, state=target)
        if target is QuestionState.SEALED:
            if report is None or report.question_id != self.question_id:
                raise ServiceModelError("seal requires this question's report")
            if settlement is not None:
                raise ServiceModelError("settlement cannot precede sealing")
            return replace(self, state=target, report=report)
        if self.report is None or settlement is None or report is not None:
            raise ServiceModelError("settlement requires the delivered report and median")
        return replace(self, state=target, settlement=settlement)

    def void(self, reason: VoidReason) -> "Question":
        """Take the universal failure edge without un-delivering a report."""
        if self.state in TERMINAL_STATES:
            raise ServiceModelError("a terminal question has no outgoing edge")
        return replace(self, state=QuestionState.VOIDED, void_reason=reason)
