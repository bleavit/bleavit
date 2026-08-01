"""06 §2.1 and 08 §2.1 — values tracks and genesis-voting scenarios.

06 §2.1 publishes six values tracks. 08 §2.1 publishes a fixed one-billion
VIT allocation, while 01 §2.2 A-3 assumes that the values electorate is not
majority-captured and 09 §7.1 requires values ratification to enter Phase 4.
This module derives only from those documents. It never reads runtime
configuration, Rust constants, or deployment validators as an oracle.

The documents establish that 650,000,000 VIT starts in three keyless
``PalletId`` pots and that no allocation identified as external is directly
signable at genesis. They do **not** establish common control across the
founding beneficiaries and ops multisig, whether vesting-locked founding VIT
is eligible for conviction voting, or the denominator of the support curves.
Those three missing facts are explicit inputs to :class:`GenesisVotingScenario`.

SQ-560 is therefore a conditional sensitivity, not an A-3 contradiction. A
scenario may ask what follows if named allocation controllers coordinate, if
vesting-locked VIT can vote, and if a particular turnout base applies. The
result reports that scenario without promoting it to normative fact. The two
document properties remain unconditional and queryable: 06/13 name no support
denominator, and the other 650,000,000 VIT is held by keyless protocol pots.

Units: money is exact whole VIT and ratios are :class:`fractions.Fraction`.
Durations are exact blocks at 14,400 blocks/day. Approval uses
conviction-weighted ayes/(ayes+nays); support uses pre-conviction aye capital
over the explicit turnout base. No binary float and no percentage rounding is
used. Where an integer minimum stake is required, division rounds **up**,
against the referendum claimant (R-7); equality with a threshold passes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

# 13 preamble / §3.5 and 08 §2.1. These are frozen protocol constants rather
# than constitution-registry keys.
BLOCKS_PER_DAY = 14_400
VIT_TOTAL_SUPPLY = 1_000_000_000
TREASURY_RESERVE_VIT = 300_000_000
COMMUNITY_DISTRIBUTION_VIT = 250_000_000
FOUNDING_TEAM_VIT = 200_000_000
ECOSYSTEM_OPS_VIT = 150_000_000
INCENTIVE_PROGRAMS_VIT = 100_000_000

GENESIS_PHASE = 3
MIN_PHASE = 0
MAX_PHASE = 7

DOC_06 = Path("docs/architecture/06-governance-and-guardians.md")
DOC_13 = Path("docs/architecture/13-parameters.md")


class ValuesLayerError(ValueError):
    """A document, scenario, or tally cannot be interpreted exactly."""


@dataclass(frozen=True)
class Curve:
    """One time-indexed referendum threshold curve, from start to tail."""

    kind: str
    start: Fraction
    end: Fraction

    def __post_init__(self) -> None:
        if self.kind not in {"linear", "reciprocal"}:
            raise ValuesLayerError(f"unknown curve kind {self.kind!r}")
        if not (0 <= self.start <= 1 and 0 <= self.end <= 1):
            raise ValuesLayerError(f"curve outside [0, 1]: {self}")


@dataclass(frozen=True)
class Track:
    """The numeric fields of one 06 §2.1 track row."""

    name: str
    decision_deposit_vit: int
    prepare_blocks: int
    decision_blocks: int
    confirm_blocks: int
    approval: Curve
    support: Curve
    enactment_blocks: int


def _clean_markdown(value: str) -> str:
    return value.replace("**", "").replace("`", "").strip()


def _percent(value: str) -> Fraction:
    match = re.fullmatch(r"\s*(\d+)\s*%\s*", value)
    if match is None:
        raise ValuesLayerError(f"not a percentage: {value!r}")
    return Fraction(int(match.group(1)), 100)


def _document_curve(value: str) -> Curve:
    clean = _clean_markdown(value)
    kind = "linear"
    for candidate in ("linear", "reciprocal"):
        if clean.startswith(candidate + " "):
            kind = candidate
            clean = clean[len(candidate) :].strip()
            break
    endpoints = [part.strip() for part in clean.split("→")]
    if len(endpoints) == 1:
        start = end = _percent(endpoints[0])
    elif len(endpoints) == 2:
        start, end = (_percent(part) for part in endpoints)
    else:
        raise ValuesLayerError(f"invalid curve cell {value!r}")
    return Curve(kind, start, end)


def _document_enactment_blocks(value: str) -> int:
    clean = _clean_markdown(value)
    if clean.startswith("immediate"):
        return 0
    day_values = [int(day) for day in re.findall(r"(\d+)\s*d\b", clean)]
    if not day_values:
        raise ValuesLayerError(f"no enactment duration in {value!r}")
    # Entrenched publishes both the symbolic four-epoch ceiling and its 168-day
    # block-denominated value. The latter is what pallet-referenda configures.
    return day_values[-1] * BLOCKS_PER_DAY


def document_tracks(repo_root: Path) -> tuple[Track, ...]:
    """Parse 06 §2.1's reconciled six-track Markdown table.

    An arrow without an explicit curve word is the table's linear form. The
    exceptional reciprocal metric-support curve names itself in the cell.
    """
    text = (repo_root / DOC_06).read_text(encoding="utf-8")
    start = text.find("### 2.1 Tracks (reconciled six-track table)")
    end = text.find("### 2.2 ", start)
    if start < 0 or end < 0:
        raise ValuesLayerError("06 §2.1 track-table section not found")

    tracks: list[Track] = []
    for line in text[start:end].splitlines():
        if not line.lstrip().startswith("| `"):
            continue
        cells = [cell.strip() for cell in line.strip().split("|")[1:-1]]
        if len(cells) != 7:
            raise ValuesLayerError(f"06 §2.1 row has {len(cells)} cells: {line}")
        name, _origin, _scope, deposit, periods, curves, enactment = cells
        period_cells = [_clean_markdown(part) for part in periods.split(" / ")]
        if len(period_cells) != 3:
            raise ValuesLayerError(f"invalid prepare/decision/confirm cell {periods!r}")
        period_days: list[int] = []
        for period in period_cells:
            match = re.fullmatch(r"(\d+)(?:\s*d)?", period)
            if match is None:
                raise ValuesLayerError(
                    f"invalid prepare/decision/confirm duration {period!r}"
                )
            period_days.append(int(match.group(1)))
        curve_cells = curves.split(" / ", 1)
        if len(curve_cells) != 2:
            raise ValuesLayerError(f"invalid approval/support cell {curves!r}")
        deposit_match = re.search(r"([\d,]+)\s+VIT", _clean_markdown(deposit))
        if deposit_match is None:
            raise ValuesLayerError(f"invalid track deposit {deposit!r}")
        tracks.append(
            Track(
                name=_clean_markdown(name),
                decision_deposit_vit=int(deposit_match.group(1).replace(",", "")),
                prepare_blocks=period_days[0] * BLOCKS_PER_DAY,
                decision_blocks=period_days[1] * BLOCKS_PER_DAY,
                confirm_blocks=period_days[2] * BLOCKS_PER_DAY,
                approval=_document_curve(curve_cells[0]),
                support=_document_curve(curve_cells[1]),
                enactment_blocks=_document_enactment_blocks(enactment),
            )
        )
    if len(tracks) != 6:
        raise ValuesLayerError(f"expected six document tracks, found {len(tracks)}")
    return tuple(tracks)


@dataclass(frozen=True)
class Allocation:
    """One 08 §2.1 allocation and its direct genesis custodian."""

    name: str
    amount_vit: int
    keyed_account: bool
    externally_allocated: bool
    vesting_locked: bool = False
    control: str = ""

    @property
    def share(self) -> Fraction:
        return Fraction(self.amount_vit, VIT_TOTAL_SUPPLY)

    def signable_at(self, phase: int, *, vesting_vote_eligible: bool) -> bool:
        """Whether the direct holder can vote in the supplied scenario.

        Phase does not manufacture a key for a ``PalletId`` account. A later
        transfer to a beneficiary creates a new, keyed holding outside this
        genesis-allocation record; only that transferred holding can vote.

        08 §2.1 does not say whether a vesting-locked balance is eligible for
        conviction voting, so ``vesting_vote_eligible`` is required and has no
        model default.
        """
        if (
            isinstance(phase, bool)
            or not isinstance(phase, int)
            or not MIN_PHASE <= phase <= MAX_PHASE
        ):
            raise ValuesLayerError(f"phase must be an integer in [{MIN_PHASE}, {MAX_PHASE}]")
        if not isinstance(vesting_vote_eligible, bool):
            raise ValuesLayerError("vesting-vote eligibility must be boolean")
        return self.keyed_account and (
            vesting_vote_eligible or not self.vesting_locked
        )


GENESIS_ALLOCATIONS: tuple[Allocation, ...] = (
    Allocation(
        "treasury_reserve",
        TREASURY_RESERVE_VIT,
        keyed_account=False,
        externally_allocated=False,
        control="keyless treasury MAIN pot",
    ),
    Allocation(
        "community_distribution",
        COMMUNITY_DISTRIBUTION_VIT,
        keyed_account=False,
        externally_allocated=False,
        control="keyless community pot until Phase-4 distributions",
    ),
    Allocation(
        "founding_team",
        FOUNDING_TEAM_VIT,
        keyed_account=True,
        externally_allocated=False,
        vesting_locked=True,
        control="keyed beneficiaries; four-year vest with one-year cliff",
    ),
    Allocation(
        "ecosystem_ops_fund",
        ECOSYSTEM_OPS_VIT,
        keyed_account=True,
        externally_allocated=False,
        control="ordinary ops-multisig account",
    ),
    Allocation(
        "phase_3_4_incentive_programs",
        INCENTIVE_PROGRAMS_VIT,
        keyed_account=False,
        externally_allocated=False,
        control="keyless incentives pot",
    ),
)


def signable_at(
    phase: int,
    *,
    vesting_vote_eligible: bool,
    allocations: tuple[Allocation, ...] = GENESIS_ALLOCATIONS,
) -> tuple[Allocation, ...]:
    """Allocations whose custodians can vote under an explicit vesting scenario."""
    return tuple(
        allocation
        for allocation in allocations
        if allocation.signable_at(
            phase, vesting_vote_eligible=vesting_vote_eligible
        )
    )


@dataclass(frozen=True)
class GenesisVotingScenario:
    """Inputs that 06/08 leave open for a genesis capture sensitivity.

    ``controller_coalition`` names whole allocation rows whose controllers are
    assumed to coordinate. That is a scenario assumption, not a document
    classification. ``turnout_base_vit=None`` records the owning documents'
    missing support denominator and prevents support-threshold evaluation.
    """

    controller_coalition: tuple[str, ...]
    vesting_vote_eligible: bool
    turnout_base_vit: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.controller_coalition, tuple) or any(
            not isinstance(name, str) for name in self.controller_coalition
        ):
            raise ValuesLayerError("controller coalition must be a tuple of names")
        if len(set(self.controller_coalition)) != len(self.controller_coalition):
            raise ValuesLayerError("controller coalition contains duplicates")
        if not isinstance(self.vesting_vote_eligible, bool):
            raise ValuesLayerError("vesting-vote eligibility must be boolean")
        if self.turnout_base_vit is not None and (
            isinstance(self.turnout_base_vit, bool)
            or not isinstance(self.turnout_base_vit, int)
            or self.turnout_base_vit <= 0
        ):
            raise ValuesLayerError(
                "turnout base must be a positive integer when supplied"
            )


@dataclass(frozen=True)
class Electorate:
    """Genesis custody viewed through one explicit voting scenario."""

    turnout_base_vit: int | None
    signable_vit: int
    coalition_signable_vit: int
    external_signable_vit: int
    keyless_vit: int
    ineligible_vesting_vit: int

    @property
    def signable_share_of_base(self) -> Fraction | None:
        if self.turnout_base_vit is None:
            return None
        return Fraction(self.signable_vit, self.turnout_base_vit)

    @property
    def coalition_share_of_signable(self) -> Fraction:
        if self.signable_vit == 0:
            return Fraction(0)
        return Fraction(self.coalition_signable_vit, self.signable_vit)


def genesis_electorate(
    *,
    scenario: GenesisVotingScenario,
    allocations: tuple[Allocation, ...] = GENESIS_ALLOCATIONS,
) -> Electorate:
    """Classify genesis custody without filling any open scenario input."""
    total = sum(allocation.amount_vit for allocation in allocations)
    if total != VIT_TOTAL_SUPPLY:
        raise ValuesLayerError(
            f"genesis allocations total {total}, expected {VIT_TOTAL_SUPPLY} VIT"
        )
    allocation_names = {allocation.name for allocation in allocations}
    unknown_controllers = tuple(
        name for name in scenario.controller_coalition if name not in allocation_names
    )
    if unknown_controllers:
        raise ValuesLayerError(
            "unknown controller-coalition allocations: "
            + ", ".join(unknown_controllers)
        )
    signable = signable_at(
        GENESIS_PHASE,
        vesting_vote_eligible=scenario.vesting_vote_eligible,
        allocations=allocations,
    )
    signable_vit = sum(allocation.amount_vit for allocation in signable)
    if (
        scenario.turnout_base_vit is not None
        and signable_vit > scenario.turnout_base_vit
    ):
        raise ValuesLayerError("signable stake exceeds the supplied turnout base")
    coalition_vit = sum(
        allocation.amount_vit
        for allocation in signable
        if allocation.name in scenario.controller_coalition
    )
    return Electorate(
        turnout_base_vit=scenario.turnout_base_vit,
        signable_vit=signable_vit,
        coalition_signable_vit=coalition_vit,
        external_signable_vit=sum(
            allocation.amount_vit
            for allocation in signable
            if allocation.externally_allocated
        ),
        keyless_vit=sum(
            allocation.amount_vit
            for allocation in allocations
            if not allocation.keyed_account
        ),
        ineligible_vesting_vit=sum(
            allocation.amount_vit
            for allocation in allocations
            if allocation.keyed_account
            and allocation.vesting_locked
            and not scenario.vesting_vote_eligible
        ),
    )


@dataclass(frozen=True)
class VoteBloc:
    """One standard conviction vote; conviction is the documented 1×–6×."""

    name: str
    stake_vit: int
    aye: bool
    conviction: int = 1

    def __post_init__(self) -> None:
        if self.stake_vit < 0:
            raise ValuesLayerError("vote stake cannot be negative")
        if not 1 <= self.conviction <= 6:
            raise ValuesLayerError("conviction must be in [1, 6]")


@dataclass(frozen=True)
class VoteTally:
    """Exact pallet-conviction-voting tally semantics for standard votes."""

    weighted_ayes: int
    weighted_nays: int
    support_capital_vit: int
    turnout_base_vit: int

    @property
    def approval(self) -> Fraction:
        denominator = self.weighted_ayes + self.weighted_nays
        return Fraction(self.weighted_ayes, denominator) if denominator else Fraction(0)

    @property
    def support(self) -> Fraction:
        return Fraction(self.support_capital_vit, self.turnout_base_vit)


@dataclass(frozen=True)
class VoteOutcome:
    """A start-of-decision-period track evaluation."""

    track: str
    approval: Fraction
    required_approval: Fraction
    support: Fraction
    required_support: Fraction

    @property
    def passed(self) -> bool:
        return self.approval >= self.required_approval and self.support >= self.required_support


def tally_votes(blocs: tuple[VoteBloc, ...], *, turnout_base_vit: int) -> VoteTally:
    """Tally standard votes exactly; refuse an incoherent support base."""
    if turnout_base_vit <= 0:
        raise ValuesLayerError("turnout base must be positive")
    support = sum(bloc.stake_vit for bloc in blocs if bloc.aye)
    total_capital = sum(bloc.stake_vit for bloc in blocs)
    if total_capital > turnout_base_vit:
        raise ValuesLayerError("voted capital exceeds the supplied turnout base")
    return VoteTally(
        weighted_ayes=sum(
            bloc.stake_vit * bloc.conviction for bloc in blocs if bloc.aye
        ),
        weighted_nays=sum(
            bloc.stake_vit * bloc.conviction for bloc in blocs if not bloc.aye
        ),
        support_capital_vit=support,
        turnout_base_vit=turnout_base_vit,
    )


def passes_at_start(
    track: Track, blocs: tuple[VoteBloc, ...], *, turnout_base_vit: int
) -> VoteOutcome:
    """Evaluate a referendum against the track's starting thresholds."""
    tally = tally_votes(blocs, turnout_base_vit=turnout_base_vit)
    return VoteOutcome(
        track=track.name,
        approval=tally.approval,
        required_approval=track.approval.start,
        support=tally.support,
        required_support=track.support.start,
    )


def _ceil_fraction(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def minimum_aye_stake_at_start(
    track: Track,
    *,
    turnout_base_vit: int,
    opposition_vit: int = 0,
    aye_conviction: int = 1,
    nay_conviction: int = 1,
) -> int:
    """Minimum whole VIT that clears both starting thresholds.

    The integer result rounds up against the enacting claimant. ``opposition``
    is assumed to vote its whole stake nay at the supplied conviction.
    """
    if turnout_base_vit <= 0 or opposition_vit < 0:
        raise ValuesLayerError("invalid turnout base or opposition stake")
    if not 1 <= aye_conviction <= 6 or not 1 <= nay_conviction <= 6:
        raise ValuesLayerError("conviction must be in [1, 6]")
    support_required = _ceil_fraction(track.support.start * turnout_base_vit)
    threshold = track.approval.start
    if threshold >= 1:
        approval_required = 1 if opposition_vit == 0 else turnout_base_vit + 1
    else:
        approval_required = _ceil_fraction(
            threshold
            * opposition_vit
            * nay_conviction
            / (aye_conviction * (1 - threshold))
        )
        if threshold > 0:
            approval_required = max(1, approval_required)
    return max(support_required, approval_required)


def genesis_coalition_outcomes(
    tracks: tuple[Track, ...], *, scenario: GenesisVotingScenario
) -> tuple[VoteOutcome, ...]:
    """Evaluate one explicit controller-coalition and turnout scenario."""
    if scenario.turnout_base_vit is None:
        raise ValuesLayerError("turnout base is required to evaluate support curves")
    electorate = genesis_electorate(scenario=scenario)
    votes = (
        VoteBloc(
            "scenario controller coalition",
            electorate.coalition_signable_vit,
            True,
        ),
        VoteBloc(
            "other directly signable controllers",
            electorate.signable_vit - electorate.coalition_signable_vit,
            False,
            conviction=6,
        ),
    )
    return tuple(
        passes_at_start(
            track, votes, turnout_base_vit=scenario.turnout_base_vit
        )
        for track in tracks
    )


@dataclass(frozen=True)
class Finding:
    """A queryable specification claim or gap."""

    key: str
    ok: bool
    detail: str


_SUPPORT_BASE_PATTERN = re.compile(
    r"\bMaxTurnout\b|\bturnout\b|"
    r"support[^\n|.]{0,100}\b(?:denominator|base|issuance|supply)\b|"
    r"\b(?:denominator|base|issuance|supply)\b[^\n|.]{0,100}\bsupport\b",
    re.IGNORECASE,
)


def support_base_mentions(repo_root: Path) -> tuple[str, ...]:
    """Lines in the owning value docs that define or name a support base."""
    matches: list[str] = []
    for path in (DOC_06, DOC_13):
        for number, line in enumerate(
            (repo_root / path).read_text(encoding="utf-8").splitlines(), start=1
        ):
            if _SUPPORT_BASE_PATTERN.search(line):
                matches.append(f"{path}:{number}: {line.strip()}")
    return tuple(matches)


def check_claims(
    repo_root: Path,
    tracks: tuple[Track, ...],
    *,
    scenario: GenesisVotingScenario,
) -> tuple[Finding, ...]:
    """Report document properties and one conditional SQ-560 sensitivity.

    ``ok=False`` is reserved for the unconditional missing-denominator defect.
    Capture and ratification results remain ``ok=True`` because the document
    leaves their scenario inputs open.
    """
    electorate = genesis_electorate(scenario=scenario)
    if scenario.turnout_base_vit is None:
        outcome_detail = "turnout base absent; support thresholds not evaluated"
    else:
        outcomes = genesis_coalition_outcomes(tracks, scenario=scenario)
        passed = tuple(outcome.track for outcome in outcomes if outcome.passed)
        outcome_detail = "scenario clears: " + (", ".join(passed) or "none")
    coalition = ", ".join(scenario.controller_coalition) or "none"
    return (
        Finding(
            "06.support-turnout-base-specified",
            bool(support_base_mentions(repo_root)),
            "06/13 support-base mentions: "
            + ("; ".join(support_base_mentions(repo_root)) or "none"),
        ),
        Finding(
            "08.external-signable-genesis-stake-is-zero",
            electorate.external_signable_vit == 0,
            f"external directly signable stake={electorate.external_signable_vit} VIT; "
            f"keyless protocol pots={electorate.keyless_vit} VIT",
        ),
        Finding(
            "A-3.genesis-capture-scenario",
            True,
            f"conditional only: coalition=[{coalition}], "
            f"vesting_vote_eligible={scenario.vesting_vote_eligible}, "
            f"coalition_signable={electorate.coalition_signable_vit}/"
            f"{electorate.signable_vit} VIT; {outcome_detail}",
        ),
    )
