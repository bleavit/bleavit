"""06 §2.1 and 08 §2.1 — the six tracks and the genesis VIT electorate.

06 §2.1 publishes six values tracks. 08 §2.1 publishes a fixed one-billion
VIT allocation, while 01 §2.2 A-3 assumes that the values electorate is not
majority-captured and 09 §7.1 requires values ratification to enter Phase 4.
This module makes those statements executable in two independent ways:

* :func:`document_tracks` parses the Markdown table itself and
  :func:`runtime_tracks` independently extracts the shipped Rust configuration;
  :func:`track_differences` compares every published curve and schedule field.
* :data:`GENESIS_ALLOCATIONS` classifies direct custody. A vesting schedule is
  a transfer lock on a keyed account, not a voting exclusion: the configured
  conviction-voting pallet votes against ``total_balance``. A pallet-derived
  pot has no signing key and cannot vote while it holds the allocation.

Executing the composition exposes what the documents do not say. At genesis,
the founding allocation (200,000,000 VIT) and ecosystem/ops allocation
(150,000,000 VIT) are the only directly signable holdings: 350,000,000 VIT,
35% of the runtime's one-billion-VIT support base and 100% of the signable
electorate. The remaining 650,000,000 VIT is in three keyless protocol pots.
The founding allocation alone supplies the entrenched track's 20% starting
support exactly; the combined insider allocations supply 35%, so insiders can
clear every track with no external aye. The Phase-3→4 arming ratification is
therefore insider-signable by construction at genesis.

At genesis the maximum 32-week conviction lock ends 141 days before the
founding allocation's one-year cliff, and currency locks compose by maximum,
not addition. Maximum conviction therefore adds **zero** blocks of transfer
restriction to that allocation then. This asymmetry is temporal, not unique:
a later community beneficiary whose VIT is already vesting can receive the
same overlap.

06 and 13 never state what a support percentage is a percentage *of*. The
runtime chooses total supply through ``MaxTurnout = VIT_TOTAL_SUPPLY``. Every
arithmetic entry point here consequently requires ``turnout_base_vit`` as an
explicit named input; the implementation choice is never a model default.

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

# 13 preamble / §3.5, mirrored from 08 §2.1. These are frozen protocol
# constants rather than constitution-registry keys.
BLOCKS_PER_DAY = 14_400
BLOCKS_PER_WEEK = 7 * BLOCKS_PER_DAY
VIT_TOTAL_SUPPLY = 1_000_000_000
TREASURY_RESERVE_VIT = 300_000_000
COMMUNITY_DISTRIBUTION_VIT = 250_000_000
FOUNDING_TEAM_VIT = 200_000_000
ECOSYSTEM_OPS_VIT = 150_000_000
INCENTIVE_PROGRAMS_VIT = 100_000_000

# 08 §2.1 founding cliff and 06 §2.1 conviction-lock ceiling.
FOUNDING_CLIFF_BLOCKS = 365 * BLOCKS_PER_DAY
MAX_CONVICTION_WEEKS = 32

GENESIS_PHASE = 3
MIN_PHASE = 0
MAX_PHASE = 7

DOC_06 = Path("docs/architecture/06-governance-and-guardians.md")
DOC_13 = Path("docs/architecture/13-parameters.md")
RUNTIME_CONFIGS = Path("runtime/bleavit-runtime/src/configs.rs")
PRIMITIVES = Path("crates/futarchy-primitives/src/lib.rs")
GENESIS_VALIDATOR = Path("tools/deploy/validate-chain-spec.py")


class ValuesLayerError(ValueError):
    """A document, configuration, or tally cannot be interpreted exactly."""


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
    track_id: int | None = None


@dataclass(frozen=True)
class TrackDifference:
    """One field on which the document and runtime disagree."""

    track: str
    field: str
    document: object
    runtime: object


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


def _named_int(source: str, name: str) -> int:
    match = re.search(
        rf"pub const {re.escape(name)}\s*:\s*\w+\s*=\s*([\d_]+)\s*;", source
    )
    if match is None:
        raise ValuesLayerError(f"runtime constant {name} not found")
    return int(match.group(1).replace("_", ""))


def _runtime_curves(source: str) -> dict[str, Curve]:
    pattern = re.compile(
        r"pub\(crate\) const (\w+_(?:APPROVAL|SUPPORT))"
        r".*?Curve::make_(linear|reciprocal)\((.*?)\);",
        re.DOTALL,
    )
    curves: dict[str, Curve] = {}
    for name, kind, arguments in pattern.findall(source):
        percentages = [
            Fraction(int(value), 100)
            for value in re.findall(r"percent\((\d+)\)", arguments)
        ]
        if kind == "linear" and len(percentages) == 2:
            # make_linear receives floor, ceil; the table publishes start→tail.
            start, end = percentages[1], percentages[0]
        elif kind == "reciprocal" and len(percentages) == 3:
            # make_reciprocal's first two percentage arguments are the table's
            # high and low endpoints; the third is the reciprocal offset.
            start, end = percentages[0], percentages[1]
        else:
            raise ValuesLayerError(
                f"unexpected runtime curve arguments for {name}: {arguments!r}"
            )
        curves[name] = Curve(kind, start, end)
    return curves


def _braced_blocks(source: str, marker: str) -> tuple[str, ...]:
    blocks: list[str] = []
    cursor = 0
    while True:
        found = source.find(marker, cursor)
        if found < 0:
            break
        opening = source.find("{", found)
        if opening < 0:
            raise ValuesLayerError(f"unclosed marker {marker!r}")
        depth = 0
        for index in range(opening, len(source)):
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append(source[found : index + 1])
                    cursor = index + 1
                    break
        else:
            raise ValuesLayerError(f"unclosed block after {marker!r}")
    return tuple(blocks)


def _field(block: str, name: str) -> str:
    match = re.search(rf"\b{re.escape(name)}\s*:\s*([^,\n]+)", block)
    if match is None:
        raise ValuesLayerError(f"runtime track field {name} not found")
    return match.group(1).strip()


def _duration_expression(expression: str, constants: dict[str, int]) -> int:
    product = 1
    for factor in (part.strip() for part in expression.split("*")):
        if re.fullmatch(r"[\d_]+", factor):
            product *= int(factor.replace("_", ""))
            continue
        key = factor.rsplit("::", 1)[-1]
        if key not in constants:
            raise ValuesLayerError(f"unsupported duration factor {factor!r}")
        product *= constants[key]
    return product


def runtime_tracks(repo_root: Path) -> tuple[Track, ...]:
    """Extract the six shipped track records from ``configs.rs``.

    This is a differential reader, not a source for model arithmetic. It is
    intentionally independent of :func:`document_tracks` so drift in either
    artifact appears as :class:`TrackDifference` rows.
    """
    source = (repo_root / RUNTIME_CONFIGS).read_text(encoding="utf-8")
    primitives = (repo_root / PRIMITIVES).read_text(encoding="utf-8")
    curves = _runtime_curves(source)
    constants = {
        "BLOCKS_PER_DAY": _named_int(primitives, "BLOCKS_PER_DAY"),
        "PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS": _named_int(
            primitives, "PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS"
        ),
    }

    array_start = source.find("pub(crate) const TRACKS:")
    array_end = source.find("\n];", array_start)
    if array_start < 0 or array_end < 0:
        raise ValuesLayerError("runtime TRACKS array not found")
    blocks = _braced_blocks(
        source[array_start:array_end], "pallet_referenda::Track {"
    )
    tracks: list[Track] = []
    for block in blocks:
        track_id = int(_field(block, "id"))
        name_match = re.search(r'name:\s*sp_runtime::str_array\("(\w+)"\)', block)
        if name_match is None:
            raise ValuesLayerError("runtime track name not found")
        deposit = _field(block, "decision_deposit")
        deposit_match = re.fullmatch(r"([\d_]+)\s*\*\s*currency::VIT", deposit)
        if deposit_match is None:
            raise ValuesLayerError(f"unsupported runtime deposit {deposit!r}")
        approval_name = _field(block, "min_approval")
        support_name = _field(block, "min_support")
        try:
            approval = curves[approval_name]
            support = curves[support_name]
        except KeyError as error:
            raise ValuesLayerError(f"runtime curve {error.args[0]} not found") from error
        tracks.append(
            Track(
                name=name_match.group(1),
                decision_deposit_vit=int(
                    deposit_match.group(1).replace("_", "")
                ),
                prepare_blocks=_duration_expression(
                    _field(block, "prepare_period"), constants
                ),
                decision_blocks=_duration_expression(
                    _field(block, "decision_period"), constants
                ),
                confirm_blocks=_duration_expression(
                    _field(block, "confirm_period"), constants
                ),
                approval=approval,
                support=support,
                enactment_blocks=_duration_expression(
                    _field(block, "min_enactment_period"), constants
                ),
                track_id=track_id,
            )
        )
    if len(tracks) != 6:
        raise ValuesLayerError(f"expected six runtime tracks, found {len(tracks)}")
    return tuple(tracks)


TRACK_FIELDS = (
    "decision_deposit_vit",
    "prepare_blocks",
    "decision_blocks",
    "confirm_blocks",
    "approval",
    "support",
    "enactment_blocks",
)


def track_differences(
    document: tuple[Track, ...], runtime: tuple[Track, ...]
) -> tuple[TrackDifference, ...]:
    """Return every 06 §2.1↔runtime difference in stable track/field order."""
    document_by_name = {track.name: track for track in document}
    runtime_by_name = {track.name: track for track in runtime}
    differences: list[TrackDifference] = []
    for name in sorted(document_by_name.keys() | runtime_by_name.keys()):
        left = document_by_name.get(name)
        right = runtime_by_name.get(name)
        if left is None or right is None:
            differences.append(TrackDifference(name, "presence", left, right))
            continue
        for field in TRACK_FIELDS:
            document_value = getattr(left, field)
            runtime_value = getattr(right, field)
            if document_value != runtime_value:
                differences.append(
                    TrackDifference(name, field, document_value, runtime_value)
                )
    return tuple(differences)


@dataclass(frozen=True)
class Allocation:
    """One 08 §2.1 allocation and its direct genesis custodian."""

    name: str
    amount_vit: int
    keyed_account: bool
    insider_controlled: bool
    vesting_locked: bool = False
    control: str = ""

    @property
    def share(self) -> Fraction:
        return Fraction(self.amount_vit, VIT_TOTAL_SUPPLY)

    def signable_at(self, phase: int) -> bool:
        """Whether the allocation's direct holder can sign a vote at ``phase``.

        Phase does not manufacture a key for a ``PalletId`` account. A later
        transfer to a beneficiary creates a new, keyed holding outside this
        genesis-allocation record; only that transferred holding can vote.
        Vesting does not negate signability because conviction voting checks
        total balance, not transferable balance.
        """
        if not isinstance(phase, int) or not MIN_PHASE <= phase <= MAX_PHASE:
            raise ValuesLayerError(f"phase must be an integer in [{MIN_PHASE}, {MAX_PHASE}]")
        return self.keyed_account


GENESIS_ALLOCATIONS: tuple[Allocation, ...] = (
    Allocation(
        "treasury_reserve",
        TREASURY_RESERVE_VIT,
        keyed_account=False,
        insider_controlled=False,
        control="keyless treasury MAIN pot",
    ),
    Allocation(
        "community_distribution",
        COMMUNITY_DISTRIBUTION_VIT,
        keyed_account=False,
        insider_controlled=False,
        control="keyless community pot until Phase-4 distributions",
    ),
    Allocation(
        "founding_team",
        FOUNDING_TEAM_VIT,
        keyed_account=True,
        insider_controlled=True,
        vesting_locked=True,
        control="keyed beneficiaries; four-year vest with one-year cliff",
    ),
    Allocation(
        "ecosystem_ops_fund",
        ECOSYSTEM_OPS_VIT,
        keyed_account=True,
        insider_controlled=True,
        control="ordinary ops-multisig account",
    ),
    Allocation(
        "phase_3_4_incentive_programs",
        INCENTIVE_PROGRAMS_VIT,
        keyed_account=False,
        insider_controlled=False,
        control="keyless incentives pot",
    ),
)


def signable_at(
    phase: int, allocations: tuple[Allocation, ...] = GENESIS_ALLOCATIONS
) -> tuple[Allocation, ...]:
    """The allocations whose direct custodians can sign at ``phase``."""
    return tuple(allocation for allocation in allocations if allocation.signable_at(phase))


@dataclass(frozen=True)
class Electorate:
    """The genesis allocation viewed through one explicit support base."""

    turnout_base_vit: int
    signable_vit: int
    insider_signable_vit: int
    external_signable_vit: int
    keyless_vit: int

    @property
    def signable_share_of_base(self) -> Fraction:
        return Fraction(self.signable_vit, self.turnout_base_vit)

    @property
    def insider_share_of_signable(self) -> Fraction:
        if self.signable_vit == 0:
            return Fraction(0)
        return Fraction(self.insider_signable_vit, self.signable_vit)


def genesis_electorate(
    *,
    turnout_base_vit: int,
    allocations: tuple[Allocation, ...] = GENESIS_ALLOCATIONS,
) -> Electorate:
    """Classify genesis custody; ``turnout_base_vit`` has deliberately no default."""
    if turnout_base_vit <= 0:
        raise ValuesLayerError("turnout base must be positive")
    total = sum(allocation.amount_vit for allocation in allocations)
    if total != VIT_TOTAL_SUPPLY:
        raise ValuesLayerError(
            f"genesis allocations total {total}, expected {VIT_TOTAL_SUPPLY} VIT"
        )
    signable = signable_at(GENESIS_PHASE, allocations)
    signable_vit = sum(allocation.amount_vit for allocation in signable)
    if signable_vit > turnout_base_vit:
        raise ValuesLayerError("signable stake exceeds the supplied turnout base")
    insider_vit = sum(
        allocation.amount_vit for allocation in signable if allocation.insider_controlled
    )
    return Electorate(
        turnout_base_vit=turnout_base_vit,
        signable_vit=signable_vit,
        insider_signable_vit=insider_vit,
        external_signable_vit=signable_vit - insider_vit,
        keyless_vit=total - signable_vit,
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


def conviction_lock_extension_blocks(
    *, existing_lock_blocks: int, conviction_weeks: int
) -> int:
    """Extra transfer-restriction time when currency locks compose by maximum.

    The founding-genesis case supplies ``FOUNDING_CLIFF_BLOCKS`` and at most
    ``MAX_CONVICTION_WEEKS``. A negative duration or a lock outside the
    documented 1–32-week range refuses rather than manufacturing lock headroom.
    """
    if existing_lock_blocks < 0:
        raise ValuesLayerError("existing lock duration cannot be negative")
    if not 1 <= conviction_weeks <= MAX_CONVICTION_WEEKS:
        raise ValuesLayerError(
            f"conviction weeks must be in [1, {MAX_CONVICTION_WEEKS}]"
        )
    conviction_blocks = conviction_weeks * BLOCKS_PER_WEEK
    return max(existing_lock_blocks, conviction_blocks) - existing_lock_blocks


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


def genesis_insider_outcomes(
    tracks: tuple[Track, ...], *, turnout_base_vit: int
) -> tuple[VoteOutcome, ...]:
    """Insiders aye versus every directly signable external VIT voting nay 6×."""
    electorate = genesis_electorate(turnout_base_vit=turnout_base_vit)
    votes = (
        VoteBloc("founding + ecosystem/ops", electorate.insider_signable_vit, True),
        VoteBloc(
            "external signable opposition",
            electorate.external_signable_vit,
            False,
            conviction=6,
        ),
    )
    return tuple(
        passes_at_start(track, votes, turnout_base_vit=turnout_base_vit)
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


def runtime_turnout_base_vit(repo_root: Path) -> int:
    """Extract the runtime's ``MaxTurnout`` choice, expressed in whole VIT."""
    configs = (repo_root / RUNTIME_CONFIGS).read_text(encoding="utf-8")
    if re.search(
        r"MaxTurnout\s*:\s*Balance\s*=\s*currency::VIT_TOTAL_SUPPLY\s*;",
        configs,
    ) is None:
        raise ValuesLayerError("runtime MaxTurnout is not VIT_TOTAL_SUPPLY")
    primitives = (repo_root / PRIMITIVES).read_text(encoding="utf-8")
    match = re.search(
        r"pub const VIT_TOTAL_SUPPLY\s*:\s*u128\s*=\s*([\d_]+)\s*\*\s*VIT\s*;",
        primitives,
    )
    if match is None:
        raise ValuesLayerError("VIT_TOTAL_SUPPLY definition not found")
    return int(match.group(1).replace("_", ""))


def check_claims(
    repo_root: Path,
    tracks: tuple[Track, ...],
    *,
    turnout_base_vit: int,
) -> tuple[Finding, ...]:
    """Evaluate A-3, the Phase-4 consequence, and the support-base gap."""
    electorate = genesis_electorate(turnout_base_vit=turnout_base_vit)
    outcomes = genesis_insider_outcomes(tracks, turnout_base_vit=turnout_base_vit)
    ratify = next((outcome for outcome in outcomes if outcome.track == "ratify"), None)
    if ratify is None:
        raise ValuesLayerError("ratify track missing from capture evaluation")
    return (
        Finding(
            "A-3.genesis-electorate-not-majority-captured",
            electorate.insider_signable_vit * 2 <= electorate.signable_vit,
            f"insiders hold {electorate.insider_signable_vit}/{electorate.signable_vit} "
            "directly signable genesis VIT",
        ),
        Finding(
            "09.phase3-to-4-needs-external-aye",
            not ratify.passed,
            "insider genesis stake clears: "
            + ", ".join(outcome.track for outcome in outcomes if outcome.passed),
        ),
        Finding(
            "06.support-turnout-base-specified",
            bool(support_base_mentions(repo_root)),
            "06/13 support-base mentions: "
            + ("; ".join(support_base_mentions(repo_root)) or "none"),
        ),
    )


@dataclass(frozen=True)
class ValidatorClassification:
    """The allocation classes enforced by ``validate-chain-spec.py``."""

    total_supply_vit: int
    founding_vested_vit: int
    ecosystem_ops_keyed_vit: int
    protocol_pots_vit: int


def _validator_vit_constant(source: str, name: str) -> int:
    match = re.search(
        rf"^{re.escape(name)}\s*=\s*([\d_]+)\s*\*\s*VIT\s*$",
        source,
        re.MULTILINE,
    )
    if match is None:
        raise ValuesLayerError(f"validator constant {name} not found")
    return int(match.group(1).replace("_", ""))


def validator_classification(repo_root: Path) -> ValidatorClassification:
    """Extract the validator's vested/keyed/pot partition for comparison."""
    source = (repo_root / GENESIS_VALIDATOR).read_text(encoding="utf-8")
    start = source.find("PROTOCOL_POTS = {")
    end = source.find("\n}\n", start)
    if start < 0 or end < 0:
        raise ValuesLayerError("validator PROTOCOL_POTS mapping not found")
    pot_amounts = [
        int(value.replace("_", ""))
        for value in re.findall(r"([\d_]+)\s*\*\s*VIT", source[start:end])
    ]
    if len(pot_amounts) != 3:
        raise ValuesLayerError(f"expected three validator pots, found {len(pot_amounts)}")
    total_match = re.search(
        r"^TOTAL_SUPPLY\s*=\s*([\d_]+)\s*\*\s*VIT\s*$",
        source,
        re.MULTILINE,
    )
    if total_match is None:
        raise ValuesLayerError("validator TOTAL_SUPPLY not found")
    return ValidatorClassification(
        total_supply_vit=int(total_match.group(1).replace("_", "")),
        founding_vested_vit=_validator_vit_constant(source, "FOUNDING_TEAM_TOTAL"),
        ecosystem_ops_keyed_vit=_validator_vit_constant(source, "OPS_FUND_TOTAL"),
        protocol_pots_vit=sum(pot_amounts),
    )
