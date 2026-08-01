"""07 §5, §6, §11 — the reporting game: bond ladder, coverage rule, latency budget.

Doc 07 prices the oracle dispute game entirely in prose and two worked example
tables. The arithmetic is small but it carries three load-bearing claims that
nothing executed:

* the value-scaled ladder makes lying unprofitable (§6's whole reason to exist);
* the §6.3 coverage rule `(2^R_max − 1)·orc.bond_bps ≥ Δs_max` is what makes
  that true, and it must be **screened at the amendment boundary** and
  **directionally** (SQ-495) — an implementation that tests only
  `coverage ≥ required` freezes both inputs in the under-covered state the rule
  exists to leave;
* the §11 latency budget "is met by construction, not by hope".

This module is the executable form. Two results fall out that doc 07 states
nowhere, and both are properties of its own numbers rather than new policy:

* **The honest challenger's break-even confidence is 5/7 ≈ 71.4 %, not 1/2.**
  §5.5 sends 40 % of the loser's stack to the winner and 60 % to INSURANCE, so
  a challenger stakes `S` to win `0.4·S`. Challenging is +EV only above
  `p > 1/1.4`. §6.2's "honest-challenger revenue also scales" is true, and the
  threshold it has to clear is not symmetric. See
  :func:`challenger_breakeven_probability`.
* **The `17.5 % of StakeAtRisk` figure in §6.2's table holds only at and above
  `StakeAtRisk = 400,000` USDC.** Below that crossover `orc.bond_floor` binds
  and the terminal forfeit is a *larger* fraction of stake — 175 % at 40k,
  1,750 % at 4k. The direction is safe (small cohorts are over-collateralized);
  §6.2's table reads as a constant and is one. See :func:`floor_crossover_stake`.
* **§11's construction claim fails at 19 of the 117 configurations in the
  registry's max-Δ/day-aligned sweep (SQ-553).** At the lawful corner
  `(epoch.length, orc.window, orc.rounds) = (201,600, 72,000, 4)`, the money
  deadline is d13⅓ and only round 1 challenge-closes by it. This does not make
  lying cheaper: the deadline force-neutralizes the value. It makes *griefing*
  cheaper, because one `B_1` challenge holds the next round open through the
  deadline where the configured ladder would otherwise require `15·B_1`; at
  the default three rounds the reduction is `7·B_1 → B_1`. The stacks are
  refunded at `retain_until`, so these are capital-lock ratios, not forfeitures.
* **The incident aggregate's maximum settlement-score impact rounds up to
  10,000 bps, against 1,750 bps of default §6.3 coverage (SQ-553).** An S1
  filing takes `I: 1 → 0`; through the exact 05 §4.4 pipeline, a maximal pair
  moves from `s = 1` to `s = 0.000031622`, a `9,999.683780000`-bps swing whose
  claimant-adverse coverage requirement is 10,000 bps. Default coverage spans
  a zeroed epoch only through honest score `0.175013229` on the 1e-9 grid.
  §7's premise that the MetricSpec surface does not carry `Δs_max` is stale:
  05 §4.4 makes `delta_s_max_bps` mandatory and bound-checks attested metrics.
  The residual is narrower and structural: `I` is not a `MetricId`, so it has
  no component row to screen. An upheld filing is refunded; this module does
  not subtract its bond from its gain, because those outcomes are exclusive.

Units: USDC in whole units; `orc.bond_bps` in basis points; `Δs_max` in basis
points (05 §4.4 fixes both). Bond arithmetic is exact integer arithmetic —
§6.1's division rounds **up**, "resolved in the direction of custody".

Latency uses blocks and exact rational days; welfare uses the 1e-9 `FixedU64`
grid. A computed welfare swing rounds **up** to whole basis points: understating
it is the unsafe, under-covered direction.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from decimal import Decimal, ROUND_CEILING
from fractions import Fraction

from . import welfare
from .spec_values import (
    EPOCH_LENGTH_DEFAULT,
    EPOCH_LENGTH_MAX,
    EPOCH_LENGTH_MAX_DELTA,
    EPOCH_LENGTH_MIN,
)

BPS_DENOMINATOR = 10_000
#: `orc.bond_bps` is stored as a `Perbill` — parts per billion (13 §1, 07 §6.3).
PERBILL_DENOMINATOR = 1_000_000_000
#: 1 bp expressed in the stored representation. The ~100,000× factor §6.3 warns
#: about is exactly this number.
PERBILL_PER_BPS = PERBILL_DENOMINATOR // BPS_DENOMINATOR

#: §5.5 slash split: the adjudicated-wrong side's stack goes 40 % to the honest
#: counterparty, 60 % to INSURANCE.
HONEST_SHARE = Fraction(40, 100)
INSURANCE_SHARE = Fraction(60, 100)

BLOCKS_PER_DAY = 14_400


class BondError(ValueError):
    """A game that cannot be opened or priced refuses (G-1)."""


def ceil_div(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        raise BondError(f"non-positive divisor {denominator}")
    if numerator < 0:
        raise BondError(f"negative dividend {numerator}")
    return -(-numerator // denominator)


# ---------------------------------------------------------------------------
# 13 §1 registry rows for the oracle keys. Bounds are the rows' own.
# ---------------------------------------------------------------------------

BOND_FLOOR_DEFAULT, BOND_FLOOR_MIN, BOND_FLOOR_MAX = 10_000, 2_500, 100_000
#: `orc.bond_bps` hard min 150 — 13 §1 justifies it as "keeps the §6.3 coverage
#: rule ≥ 10.5 % at `R_max = 3`", which §6.3 then labels illustrative, not a floor.
BOND_BPS_DEFAULT, BOND_BPS_MIN, BOND_BPS_MAX = 250, 150, 1_000
#: `orc.rounds` carries **no max-Δ** (13 §1), so 3 → 2 is a single lawful step.
ROUNDS_DEFAULT, ROUNDS_MIN, ROUNDS_MAX = 3, 2, 4
#: `orc.window` — 72 h kernel floor, never lowered; META may raise to 120 h.
ORC_WINDOW_DEFAULT, ORC_WINDOW_MIN, ORC_WINDOW_MAX = 43_200, 43_200, 72_000
#: 07 §7 registry filing-bond floors (`reg.bond_inc` / `reg.bond_mile`).
REG_BOND_INCIDENT, REG_BOND_MILESTONE = 5_000, 2_500
#: `reg.max_filings_epoch` — 13 §2 / 07 §7, shared across frozen versions.
REG_MAX_FILINGS_EPOCH = 64
#: 05 §4.4 fixes `Δs_max`'s units and its `0 < Δs_max ≤ 10,000` bound.
DELTA_S_MAX_MIN, DELTA_S_MAX_MAX = 1, 10_000

#: 05 §4.3 / 07 §7: exact incident severities folded over upheld filings only.
INCIDENT_SEVERITIES: dict[str, Fraction] = {
    "S1": Fraction(1),
    "S2": Fraction(2, 5),
    "S3": Fraction(1, 10),
}


@dataclass(frozen=True)
class OracleParams:
    """The three 13 §1 keys that price a game, frozen per game at round 1."""

    bond_floor: int = BOND_FLOOR_DEFAULT
    bond_bps: int = BOND_BPS_DEFAULT
    rounds: int = ROUNDS_DEFAULT

    def in_bounds(self) -> bool:
        return (
            BOND_FLOOR_MIN <= self.bond_floor <= BOND_FLOOR_MAX
            and BOND_BPS_MIN <= self.bond_bps <= BOND_BPS_MAX
            and ROUNDS_MIN <= self.rounds <= ROUNDS_MAX
        )


DEFAULTS = OracleParams()


# ---------------------------------------------------------------------------
# §6.1 — bond definitions.
# ---------------------------------------------------------------------------


def bond_1(stake_at_risk: int, params: OracleParams = DEFAULTS) -> int:
    """`B_1 = max(orc.bond_floor, ceil(orc.bond_bps × StakeAtRisk / 10,000))`.

    §6.1 *Units and rounding*: the `/10,000` divisor rounds **up**, and the
    `max(·)` against the floor is applied **after** rounding. Rounding a bond
    down is the under-custody direction; up costs at most one base unit.
    """
    if stake_at_risk < 0:
        raise BondError(f"negative StakeAtRisk {stake_at_risk}")
    scaled = ceil_div(params.bond_bps * stake_at_risk, BPS_DENOMINATOR)
    return max(params.bond_floor, scaled)


def bond_r(b1: int, round_index: int, params: OracleParams = DEFAULTS) -> int:
    """`B_r = B_1 · 2^(r−1)`, `r = 1…R_max`."""
    if not 1 <= round_index <= params.rounds:
        raise BondError(f"round {round_index} outside 1…{params.rounds}")
    return b1 * 2 ** (round_index - 1)


def ladder(b1: int, params: OracleParams = DEFAULTS) -> tuple[int, ...]:
    """The complete frozen ladder `B_1 … B_1·2^(R_max−1)`."""
    return tuple(bond_r(b1, r, params) for r in range(1, params.rounds + 1))


def cumulative_forfeit(b1: int, through_round: int, params: OracleParams = DEFAULTS) -> int:
    """`(2^r − 1)·B_1` — the stack a side has posted through round `r`.

    §6.2's third column. Each side posts each round's bond, so the geometric
    sum is what the adjudicated-wrong side forfeits.
    """
    if not 1 <= through_round <= params.rounds:
        raise BondError(f"round {through_round} outside 1…{params.rounds}")
    return (2**through_round - 1) * b1


def terminal_stack(stake_at_risk: int, params: OracleParams = DEFAULTS) -> int:
    """The full stack at risk if a side rides the game to `R_max`."""
    return cumulative_forfeit(bond_1(stake_at_risk, params), params.rounds, params)


def ladder_representable(b1: int, params: OracleParams, balance_max: int) -> bool:
    """§6.1: refuse to open a game whose complete frozen ladder is unrepresentable.

    "so that a lawfully opened round can never become uncloseable". The test is
    on the whole ladder, not on `B_1`: `B_1` alone always fits where the top
    round may not.
    """
    try:
        return max(ladder(b1, params)) <= balance_max
    except BondError:
        return False


def floor_crossover_stake(params: OracleParams = DEFAULTS) -> Fraction:
    """The `StakeAtRisk` at which the bps leg overtakes `orc.bond_floor`.

    Below it the floor binds and the terminal forfeit is a *larger* fraction of
    stake than §6.2's table states; at and above it the table's `17.5 %` is
    exact. At the defaults this is `10,000 / 0.025 = 400,000` USDC — which is
    also, not coincidentally, the `StakeAtRisk` of §5's worked example, the one
    point where the two legs coincide.
    """
    return Fraction(params.bond_floor * BPS_DENOMINATOR, params.bond_bps)


def terminal_forfeit_fraction(stake_at_risk: int, params: OracleParams = DEFAULTS) -> Fraction:
    """The terminal stack as a fraction of `StakeAtRisk` (§6.2's `17.5 %`)."""
    if stake_at_risk <= 0:
        raise BondError("StakeAtRisk must be positive to express a fraction of it")
    return Fraction(terminal_stack(stake_at_risk, params), stake_at_risk)


# ---------------------------------------------------------------------------
# §5.5 — slashing, and the incentives that follow from the split.
# ---------------------------------------------------------------------------


def slash_split(stack: int) -> tuple[int, int]:
    """§5.5: 40 % of the forfeited stack to the honest counterparty, 60 % to INSURANCE.

    Rounds the honest share **down** so the two parts never exceed the stack —
    the residual base unit goes to INSURANCE, which is the direction that
    cannot create an unbacked claim (R-7).
    """
    if stack < 0:
        raise BondError(f"negative stack {stack}")
    honest = int(HONEST_SHARE * stack)
    return honest, stack - honest


def default_slash_split(stack: int, round_: int) -> tuple[int, int]:
    """§5.5's contract-v18 exception to `slash_split` for a §5.3 **default**.

    A default is not an adjudicated finding. At round 1 the game holds exactly
    two unrebutted assertions and one was abandoned, and nothing on chain
    distinguishes an honest catch from a griefing or self-dealt one — §5.2
    freezes no reporter/challenger distinctness, and none stronger is
    implementable while §4's "entity registry per 05" does not exist. So the
    whole stack routes to INSURANCE and **no bounty is paid**: paying there is
    what makes challenging an honest *offline* reporter profitable, and it is
    the leg that turned the self-challenge below into a profit.

    From round 2 the reporter consented to escalate, re-asserted under a
    doubled bond and only then abandoned. That is a concession by conduct
    against a contest the challenger actually funded, so §6.2's
    honest-challenger revenue applies and §5.5's ordinary 40/60 split stands.

    Returns `(to_counterparty, to_insurance)`, like `slash_split`.
    """
    if stack < 0:
        raise BondError(f"negative stack {stack}")
    if round_ < 1:
        raise BondError(f"round {round_} below 1")
    if round_ == 1:
        return 0, stack
    return slash_split(stack)


def challenger_breakeven_probability() -> Fraction:
    """The confidence an honest challenger needs before challenging is +EV.

    Both sides post the same per-round bonds, so at any round the challenger
    risks their own stack `S` to win `0.4·S` of the reporter's. The EV is
    `p·0.4·S − (1−p)·S`, zero at `p = 1/1.4 = 5/7`. The threshold is
    round-independent: `S` cancels.

    This is a consequence of §5.5's split, not a defect — the 60 % to INSURANCE
    is what funds the backstop — but it means "challenge incentives grow with
    exactly the value that needs defending" (§6.2) describes the *scale* of the
    reward and not its sign.
    """
    return 1 / (1 + HONEST_SHARE)


def challenger_expected_value(stack: int, win_probability: Fraction) -> Fraction:
    """EV of carrying a challenge to adjudication, in USDC."""
    honest, _ = slash_split(stack)
    return win_probability * honest - (1 - win_probability) * stack


# ---------------------------------------------------------------------------
# §6.3 — the coverage rule and its amendment screen.
# ---------------------------------------------------------------------------


def coverage_bps(params: OracleParams) -> int:
    """`(2^R_max − 1) · orc.bond_bps` — §6.3's coverage rate, in basis points."""
    if params.rounds < 1:
        raise BondError(f"orc.rounds {params.rounds} below 1")
    return (2**params.rounds - 1) * params.bond_bps


def admits_component(delta_s_max: int, params: OracleParams) -> bool:
    """§6.3's admission rule, evaluated against the **live** parameters.

    §6.3 (SQ-341): "an implementation MUST NOT hardcode the 10.5 % figure or
    assume `R_max = 3`".
    """
    if not DELTA_S_MAX_MIN <= delta_s_max <= DELTA_S_MAX_MAX:
        raise BondError(f"Δs_max {delta_s_max} outside 05 §4.4's (0, 10,000]")
    return coverage_bps(params) >= delta_s_max


def naive_perbill_admits_component(delta_s_max: int, params: OracleParams) -> bool:
    """The §6.3 unit defect, made executable rather than described.

    `orc.bond_bps` is stored as a `Perbill`. A screen that compares the raw
    stored value against a `Δs_max` in basis points "reads every proposed rate
    as ~100,000× more generous than it is and admits precisely the amendments
    this rule exists to refuse". This function is that screen; it exists so a
    test can show it admitting a component the correct one refuses.
    """
    stored = params.bond_bps * PERBILL_PER_BPS
    return (2**params.rounds - 1) * stored >= delta_s_max


def required_coverage_bps(admitted_delta_s_max: tuple[int, ...]) -> int:
    """The binding requirement: the largest `Δs_max` over admitted components.

    §6.3: "The scope is every *registered* version, not only the versions live
    cohorts froze" — a version registered today activates later, and its
    components were admitted against today's ladder.
    """
    return max(admitted_delta_s_max, default=0)


@dataclass(frozen=True)
class AmendmentVerdict:
    admitted: bool
    reason: str = ""
    coverage_before: int = 0
    coverage_after: int = 0
    required: int = 0


def amendment_admissible(
    live: OracleParams,
    proposed: OracleParams,
    admitted_delta_s_max: tuple[int, ...] = (),
) -> AmendmentVerdict:
    """§6.3's amendment-boundary screen (SQ-495), with its three normative properties.

    Refuses exactly a *further lowering* below the requirement. Specifically::

        refuse ⟺ coverage_after < coverage_before ∧ coverage_after < required

    All three of §6.3's stated properties are consequences of that predicate:

    1. screened at the governance boundary, not at snapshot time (fail-closed);
    2. scope is every registered version;
    3. directional — non-decreasing is always permitted, and so is any
       amendment while no attested component is admitted. Testing only
       `coverage ≥ required` instead "freezes **both** inputs permanently in
       exactly the under-covered state this rule exists to leave".
    """
    if not proposed.in_bounds():
        return AmendmentVerdict(False, "outside 13 §1 bounds")
    before, after = coverage_bps(live), coverage_bps(proposed)
    required = required_coverage_bps(admitted_delta_s_max)
    if after >= before:
        return AmendmentVerdict(True, "non-decreasing coverage", before, after, required)
    if not admitted_delta_s_max:
        return AmendmentVerdict(True, "no admitted component", before, after, required)
    if after >= required:
        return AmendmentVerdict(True, "still covers every admitted Δs_max", before, after, required)
    return AmendmentVerdict(False, "further lowering below an admitted Δs_max", before, after, required)


def naive_amendment_admissible(
    live: OracleParams,
    proposed: OracleParams,
    admitted_delta_s_max: tuple[int, ...] = (),
) -> AmendmentVerdict:
    """The non-directional screen §6.3 forbids: `coverage ≥ required`, full stop.

    Kept so a test can exhibit the freeze: from an under-covered state it
    refuses every repair, including strict raises.
    """
    after = coverage_bps(proposed)
    required = required_coverage_bps(admitted_delta_s_max)
    ok = after >= required
    return AmendmentVerdict(
        ok, "coverage ≥ required" if ok else "coverage < required",
        coverage_bps(live), after, required,
    )


# ---------------------------------------------------------------------------
# §6.3 — the attacker's arithmetic (the review scenario, recomputed).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AttackOutcome:
    b1: int
    stack: int
    gross_gain: Fraction
    net: Fraction

    @property
    def profitable(self) -> bool:
        return self.net > 0


def attack_outcome(
    stake_at_risk: int,
    delta_s_bps: int,
    params: OracleParams = DEFAULTS,
    position_share: Fraction = Fraction(1),
) -> AttackOutcome:
    """Best-case net for a reporter who lies and is adjudicated wrong.

    §6.3: "gross gain bounded by `0.10 × 1,200,000 = 120,000` USDC (attained
    only if the attacker holds *every* winning scalar unit)". `position_share`
    is that holding; 1 is the bound, and any realistic share deepens the loss.
    """
    if not Fraction(0) <= position_share <= Fraction(1):
        raise BondError(f"position share {position_share} outside [0, 1]")
    b1 = bond_1(stake_at_risk, params)
    stack = cumulative_forfeit(b1, params.rounds, params)
    gross = Fraction(delta_s_bps * stake_at_risk, BPS_DENOMINATOR) * position_share
    return AttackOutcome(b1, stack, gross, gross - stack)


def flat_bond_attack_outcome(
    stake_at_risk: int, delta_s_bps: int, flat_bond: int = BOND_FLOOR_DEFAULT,
    rounds: int = ROUNDS_DEFAULT, position_share: Fraction = Fraction(1),
) -> AttackOutcome:
    """The superseded flat-bond regime, for §6.3's comparison table.

    §6 opens with why it was replaced: "on a ~1.2M-USDC META cohort, shifting
    `s` by 0.10 on a subjective attested component netted ~+50k USDC even after
    forfeiting the full flat 70k stack".
    """
    stack = (2**rounds - 1) * flat_bond
    gross = Fraction(delta_s_bps * stake_at_risk, BPS_DENOMINATOR) * position_share
    return AttackOutcome(flat_bond, stack, gross, gross - stack)


def coverage_makes_lying_unprofitable(
    stake_at_risk: int, delta_s_max: int, params: OracleParams = DEFAULTS
) -> bool:
    """Whether §6.3's rule delivers what it promises at this stake.

    The rule is an inequality on *rates*; this evaluates it on the money, for a
    reporter holding the whole winning side. It is the property the coverage
    rule exists to buy, so it is checked rather than assumed.
    """
    return attack_outcome(stake_at_risk, delta_s_max, params).net <= 0


# ---------------------------------------------------------------------------
# §5.3 — one account on both sides of the game (contract v19).
#
# §6.3 sizes the ladder against `Δs_max` on the assumption that a lie must be
# ridden to `R_max` to land, so the liar forfeits `(2^R_max − 1)·B_1`. A
# reporter who challenges *itself* and then defaults never pays that: the game
# terminates at round 1 having risked one rung. This prices both regimes so the
# coverage rule's promise is checked against the cheapest path to a settled
# value, not only against the honest-attacker path `attack_outcome` models.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SelfChallengeOutcome:
    """One economic party occupying both roles of a §5.3 default, priced."""

    b1: int
    #: The full ladder §6.3 sized the coverage rule against.
    required_ladder: int
    #: The one stack the attack actually puts at risk (round 1 only).
    risked: int
    #: Refunded to the attacker's own "honest counterparty" identity.
    bounty: Fraction
    #: `risked − bounty` — what terminating at round 1 really costs.
    net_cost: Fraction
    gross_gain: Fraction
    net: Fraction

    @property
    def profitable(self) -> bool:
        return self.net > 0

    @property
    def ladder_fraction(self) -> Fraction:
        """Net cost as a share of the ladder §6.3 required.

        This is the number that shows the coverage rule was bypassed rather
        than merely beaten: the rule can be satisfied exactly and still be paid
        in a small fraction of the stack it sized.
        """
        return Fraction(self.net_cost, 1) / self.required_ladder


def self_challenge_outcome(
    stake_at_risk: int,
    delta_s_bps: int,
    params: OracleParams = DEFAULTS,
    position_share: Fraction = Fraction(1),
    *,
    neutralized: bool,
) -> SelfChallengeOutcome:
    """A reporter challenges itself, then defaults at round 1.

    Both leaves are `CallDomain::Public`, so one `utility.batch_all([report,
    challenge])` takes both roles atomically and the front-running window is
    zero. `AlreadyChallenged` then locks every honest challenger out, and
    `adjudicate` is unreachable below `round_cap`, so nothing but the default
    can end the game.

    `neutralized=False` prices the **pre-v18** rule, where a default settled
    the challenger's counter-value *forward and unflagged*. The attacker puts
    the false value on the challenger side, abandons the reporter side, and its
    own counterparty bounty refunds 40 % of the single stack it risked — so the
    false value reaches `C_attested` (and thus `W`) having paid a fraction of a
    rung.

    `neutralized=True` prices the **v18** repair: the default takes §10's
    neutral carry-last/flagged path, so the false value never lands at all
    (`gross_gain = 0`), and §5.5's round-1 exception pays no bounty. The repair
    is on the *value* side because §5.3's own closing sentences forbid debiting
    an unfunded stack — no rule can make a defaulting party forfeit rungs it
    never posted, so the gain, not the cost, is what had to move.
    """
    if not Fraction(0) <= position_share <= Fraction(1):
        raise BondError(f"position share {position_share} outside [0, 1]")
    b1 = bond_1(stake_at_risk, params)
    required_ladder = cumulative_forfeit(b1, params.rounds, params)
    risked = b1
    if neutralized:
        bounty = Fraction(0)
        gross = Fraction(0)
    else:
        bounty = HONEST_SHARE * b1
        gross = Fraction(delta_s_bps * stake_at_risk, BPS_DENOMINATOR) * position_share
    net_cost = risked - bounty
    return SelfChallengeOutcome(
        b1, required_ladder, risked, bounty, net_cost, gross, gross - net_cost
    )


# ---------------------------------------------------------------------------
# §7 — the registry filing bond, the coverage rate's second consumer (SQ-296).
# ---------------------------------------------------------------------------


def filing_bond(kind: str, exposure: int, params: OracleParams = DEFAULTS) -> int:
    """`F(kind, m) = max(reg.bond_{kind}, ceil(coverage_bps × Exposure / 10,000))`.

    13 §1: a one-round game must post the whole ladder up front, so the filing
    bond is priced at the §6.3 *coverage* rate rather than at `orc.bond_bps`.
    An `orc.bond_bps` amendment therefore moves registry filing cost too — in
    the safe direction, since a raise makes false claims dearer on both surfaces.
    """
    floors = {"incident": REG_BOND_INCIDENT, "milestone": REG_BOND_MILESTONE}
    if kind not in floors:
        raise BondError(f"unknown filing kind {kind!r}")
    if exposure < 0:
        raise BondError(f"negative exposure {exposure}")
    scaled = ceil_div(coverage_bps(params) * exposure, BPS_DENOMINATOR)
    return max(floors[kind], scaled)


# ---------------------------------------------------------------------------
# §7 — the incident aggregate's effective `Δs_max` (SQ-553).
# ---------------------------------------------------------------------------


def incident_aggregate(upheld_severities: Iterable[str]) -> Fraction:
    """`I = max(0, 1 − Σ severity)` over §7's upheld incident filings.

    The fold is rational: S1/S2/S3 are exactly 1, 2/5 and 1/10. Unknown
    severities and a filing count above `reg.max_filings_epoch` refuse rather
    than fabricating a favourable aggregate. Rejected and still-open filings
    are deliberately absent from the input; §7 says only `Upheld` records fold.
    """
    severities = tuple(upheld_severities)
    if len(severities) > REG_MAX_FILINGS_EPOCH:
        raise BondError(
            f"{len(severities)} incident filings exceeds "
            f"reg.max_filings_epoch {REG_MAX_FILINGS_EPOCH}"
        )
    total = Fraction(0)
    for severity in severities:
        try:
            total += INCIDENT_SEVERITIES[severity]
        except KeyError as exc:
            raise BondError(f"unknown incident severity {severity!r}") from exc
    return max(Fraction(0), Fraction(1) - total)


@dataclass(frozen=True)
class IncidentImpact:
    """The maximal one-epoch incident move through 05 §4.4's full pipeline."""

    aggregate_before: Fraction
    aggregate_after: Fraction
    honest_w: Decimal
    incident_w: Decimal
    honest_score: Decimal
    incident_score: Decimal
    delta_score: Decimal
    delta_bps_exact: Decimal
    delta_s_max_bps: int


def _maximal_epoch_pipeline(incident: Fraction) -> dict[str, Decimal]:
    """A 05 §4.3 v1 epoch at the top of every normalized input range.

    This is a witness of the global maximum, not a calibration scenario. All
    inputs and every pipeline output live in [0, 1], so no incident can start
    above the honest `W = 1` produced here. S1 makes `I = 0`; because §4.4
    makes I a pure multiplier, no incident can land below the `W = 0` produced
    here either. Holding the other horizon epoch at 1 maximizes both geometric
    means' difference.
    """
    one = Decimal(1)
    return welfare.full_pipeline(
        u=one,
        f=one,
        hhi=Decimal(0),
        phase=6,
        c_onchain={1: one, 2: one, 3: one, 4: one, 5: one, 6: one},
        c_weights={
            1: Decimal("0.25"),
            2: Decimal("0.25"),
            3: Decimal("0.20"),
            4: Decimal("0.15"),
            5: Decimal("0.10"),
            6: Decimal("0.05"),
        },
        incident=Decimal(incident.numerator) / Decimal(incident.denominator),
        p_components={20: one, 21: one, 22: one},
        p_weights={
            20: Decimal("0.45"),
            21: Decimal("0.35"),
            22: Decimal("0.20"),
        },
        a_components={30: one, 31: one, 32: one},
        a_weights={
            30: Decimal("0.40"),
            31: Decimal("0.30"),
            32: Decimal("0.30"),
        },
    )


def delta_s_max_of_incident_aggregate() -> IncidentImpact:
    """Derive §7's incident aggregate maximum through `welfare.full_pipeline`.

    One upheld S1 filing is sufficient: `I = max(0, 1 − 1) = 0`. The affected
    epoch is the first member of a two-epoch settlement pair; the other stays
    at the maximal honest `W = 1`. `settlement_score` applies §4.4's 1e-9 floor
    before the square root, so the attacked score is positive rather than zero.

    `delta_s_max_bps` rounds the exact grid swing **up**. Rounding down could
    admit an incident surface whose real move exceeds its coverage; up is the
    claimant-adverse, custody-safe direction (R-7).
    """
    before = incident_aggregate(())
    after = incident_aggregate(("S1",))
    honest = _maximal_epoch_pipeline(before)
    attacked = _maximal_epoch_pipeline(after)
    honest_score = welfare.settlement_score(honest["W"], honest["W"])
    incident_score = welfare.settlement_score(attacked["W"], honest["W"])
    delta_score = honest_score - incident_score
    exact_bps = delta_score * Decimal(BPS_DENOMINATOR)
    required_bps = int(exact_bps.to_integral_value(rounding=ROUND_CEILING))
    return IncidentImpact(
        before,
        after,
        honest["W"],
        attacked["W"],
        honest_score,
        incident_score,
        delta_score,
        exact_bps,
        required_bps,
    )


def incident_zeroed_epoch_delta_bps(honest_score: Decimal) -> Decimal:
    """Impact of zeroing one epoch when both honest horizon epochs score alike.

    With equal honest epoch welfare values, the honest settlement score is that
    same grid value. S1 changes one `W` to zero; §4.4 then scores the attacked
    pair as `sqrt(max(0, 1e-9) × honest_score)`, using the shared welfare
    implementation rather than re-stating its rounding.
    """
    honest_w = welfare.floor_fixed(honest_score)
    if not Decimal(0) <= honest_w <= Decimal(1):
        raise BondError(f"honest score {honest_w} outside [0, 1]")
    honest_pair_score = welfare.settlement_score(honest_w, honest_w)
    attacked_score = welfare.settlement_score(Decimal(0), honest_w)
    return (honest_pair_score - attacked_score) * Decimal(BPS_DENOMINATOR)


def honest_score_coverage_crossover(params: OracleParams = DEFAULTS) -> Decimal:
    """Largest 1e-9-grid honest score whose S1 swing §6.3 coverage spans.

    The predicate is monotone, so a deterministic integer binary search finds
    the exact grid boundary. At defaults it is 0.175013229: its incident swing
    is exactly 1,750 bps, while the next grid point moves 1,750.00001 bps.
    """
    if not params.in_bounds():
        raise BondError("oracle parameters outside 13 §1 bounds")
    available = Decimal(coverage_bps(params))
    low, high = 0, welfare.FIXED_SCALE
    while low < high:
        middle = (low + high + 1) // 2
        score = Decimal(middle).scaleb(-9)
        if incident_zeroed_epoch_delta_bps(score) <= available:
            low = middle
        else:
            high = middle - 1
    return Decimal(low).scaleb(-9)


@dataclass(frozen=True)
class IncidentCoverageFinding:
    """Queryable form of §7's one-round coverage claim (SQ-553)."""

    key: str
    ok: bool
    coverage_bps: int
    required_bps: int
    shortfall_factor: Fraction
    honest_score_crossover: Decimal
    impact: IncidentImpact


def check_incident_coverage(
    params: OracleParams = DEFAULTS,
) -> IncidentCoverageFinding:
    """Compare incident `Δs_max` with the §6.3 rate §7 actually reuses.

    This is a rate comparison, not `gain − filing_bond`: an upheld filing is
    refunded, while a rejected filing moves no incident aggregate. Combining
    the gain from the first outcome with forfeiture from the second would price
    an impossible game.
    """
    impact = delta_s_max_of_incident_aggregate()
    available = coverage_bps(params)
    return IncidentCoverageFinding(
        key="incident aggregate Δs_max vs §6.3 coverage",
        ok=available >= impact.delta_s_max_bps,
        coverage_bps=available,
        required_bps=impact.delta_s_max_bps,
        shortfall_factor=Fraction(impact.delta_s_max_bps, available),
        honest_score_crossover=honest_score_coverage_crossover(params),
        impact=impact,
    )


# ---------------------------------------------------------------------------
# §11 — the latency budget, "met by construction, not by hope".
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LatencyStage:
    name: str
    days: int


#: §11's table, anchored at `t0` = close of measurement epoch `m`. The single
#: 48 h quorum extension is part of round 1's line, per the table.
LATENCY_STAGES: tuple[LatencyStage, ...] = (
    LatencyStage("report window", 2),
    LatencyStage("round 1 (72 h) + the single 48 h quorum extension", 3 + 2),
    LatencyStage("round 2 (72 h)", 3),
    LatencyStage("round 3 (72 h)", 3),
    LatencyStage("terminal: OracleResolution 7 d decision + 1 d confirm", 8),
)

#: §11(1): `OracleSettleDeadline(m)` = start of epoch(m+1) Housekeeping = d20.
#: 05 §3.1 puts Housekeeping at 20/21 of the epoch, so this is a schedule
#: consequence rather than an independent constant.
MONEY_DEADLINE_DAY = 20
#: 05 §3.1's Housekeeping fraction; `epoch.length` is a multiple of 21.
HOUSEKEEPING_NUMERATOR, PHASE_DENOMINATOR = 20, 21
#: §5/§11 absolute windows; these do not scale with `epoch.length`.
REPORT_WINDOW_BLOCKS = 2 * BLOCKS_PER_DAY
ORC_EXT_WINDOW_BLOCKS = 2 * BLOCKS_PER_DAY
ORACLE_DECISION_BLOCKS = 7 * BLOCKS_PER_DAY
ORACLE_CONFIRM_BLOCKS = BLOCKS_PER_DAY
#: 07 §11 rule 3: the single-extension rule keeps the sum at 21 d; per-round
#: extensions would add 4 d. Rounds 2 and 3 would each gain one 2 d extension.
PER_ROUND_EXTENSION_DAYS = 2

# The `orc.window` row has no max-Δ. These are every whole-day point in its
# 72 h…120 h interval; together with `epoch_length_max_delta_lattice()` and
# all integer `orc.rounds`, they form the 117-point SQ-553 sweep.
ORC_WINDOW_DAY_LATTICE = tuple(
    range(ORC_WINDOW_MIN, ORC_WINDOW_MAX + 1, BLOCKS_PER_DAY)
)


@dataclass(frozen=True)
class LatencyClose:
    """One §11 stage's exact close time after measurement epoch close."""

    name: str
    days: Fraction
    round_index: int | None = None


def money_deadline_days(epoch_length_blocks: int) -> Fraction:
    """`20/21 · epoch.length`, expressed as exact days after `t0`.

    05 §3.1 requires `epoch.length` to be a multiple of 21, so the Housekeeping
    boundary is an integer block. No rounding is permitted: rounding it up
    would grant a contested value extra money-bearing time, the unsafe direction.
    """
    if epoch_length_blocks <= 0:
        raise BondError(f"non-positive epoch.length {epoch_length_blocks}")
    if epoch_length_blocks % PHASE_DENOMINATOR:
        raise BondError(
            f"epoch.length {epoch_length_blocks} is not a multiple of "
            f"{PHASE_DENOMINATOR}"
        )
    deadline_blocks = (
        HOUSEKEEPING_NUMERATOR * epoch_length_blocks // PHASE_DENOMINATOR
    )
    return Fraction(deadline_blocks, BLOCKS_PER_DAY)


def stage_closes(
    orc_window_blocks: int = ORC_WINDOW_DEFAULT,
    orc_rounds: int = ROUNDS_DEFAULT,
) -> tuple[LatencyClose, ...]:
    """§11's cumulative closes for a live window/round parameter pair.

    Report, challenge and extension windows are absolute block counts. The
    single 48 h extension belongs to round 1 only; the terminal decision and
    confirmation add eight days after the configured final round. All outputs
    are exact `Fraction` days, including non-day-aligned lawful window values.
    """
    if not ORC_WINDOW_MIN <= orc_window_blocks <= ORC_WINDOW_MAX:
        raise BondError(
            f"orc.window {orc_window_blocks} outside "
            f"[{ORC_WINDOW_MIN}, {ORC_WINDOW_MAX}]"
        )
    if not ROUNDS_MIN <= orc_rounds <= ROUNDS_MAX:
        raise BondError(
            f"orc.rounds {orc_rounds} outside [{ROUNDS_MIN}, {ROUNDS_MAX}]"
        )
    running = REPORT_WINDOW_BLOCKS
    closes = [LatencyClose("report window", Fraction(running, BLOCKS_PER_DAY))]
    for round_index in range(1, orc_rounds + 1):
        running += orc_window_blocks
        if round_index == 1:
            running += ORC_EXT_WINDOW_BLOCKS
        closes.append(
            LatencyClose(
                f"round {round_index}",
                Fraction(running, BLOCKS_PER_DAY),
                round_index,
            )
        )
    running += ORACLE_DECISION_BLOCKS + ORACLE_CONFIRM_BLOCKS
    closes.append(LatencyClose("terminal decision + confirm", Fraction(running, BLOCKS_PER_DAY)))
    return tuple(closes)


def last_live_round(
    epoch_length_blocks: int,
    orc_window_blocks: int = ORC_WINDOW_DEFAULT,
    orc_rounds: int = ROUNDS_DEFAULT,
) -> int:
    """Highest configured round challenge-closed **by** the money deadline.

    §11 says "not challenge-closed **by** the deadline" neutralizes, and the
    pre-existing `settles_neutrally(20)` pin treats an exact d20 close as live.
    The comparison is therefore inclusive. The brief's phrase "before" is not
    the document's fencepost rule; treating equality as late would add one more
    failed sweep point, `(302,400, 57,600, 4)`.
    """
    if not EPOCH_LENGTH_MIN <= epoch_length_blocks <= EPOCH_LENGTH_MAX:
        raise BondError(
            f"epoch.length {epoch_length_blocks} outside "
            f"[{EPOCH_LENGTH_MIN}, {EPOCH_LENGTH_MAX}]"
        )
    deadline = money_deadline_days(epoch_length_blocks)
    return max(
        (
            close.round_index
            for close in stage_closes(orc_window_blocks, orc_rounds)
            if close.round_index is not None and close.days <= deadline
        ),
        default=0,
    )


def epoch_length_max_delta_lattice() -> tuple[int, ...]:
    """Extremal 10 %-max-Δ walks from genesis to both `epoch.length` bounds.

    Each step moves as far as the row permits while preserving 05 §3.1's
    multiple-of-21 requirement: downward moves round toward the live value
    (ceil to 21), upward moves likewise (floor to 21). The final step clamps to
    the bound. This yields 13 reachable points, not a hand-selected sample.
    """
    values = {EPOCH_LENGTH_DEFAULT}
    live = EPOCH_LENGTH_DEFAULT
    while live > EPOCH_LENGTH_MIN:
        minimum_lawful = ceil_div(
            live * (EPOCH_LENGTH_MAX_DELTA.denominator - EPOCH_LENGTH_MAX_DELTA.numerator),
            EPOCH_LENGTH_MAX_DELTA.denominator,
        )
        proposed = ceil_div(minimum_lawful, PHASE_DENOMINATOR) * PHASE_DENOMINATOR
        proposed = max(EPOCH_LENGTH_MIN, proposed)
        if proposed >= live:
            raise BondError("epoch.length downward lattice made no progress")
        values.add(proposed)
        live = proposed

    live = EPOCH_LENGTH_DEFAULT
    while live < EPOCH_LENGTH_MAX:
        maximum_lawful = (
            live
            * (EPOCH_LENGTH_MAX_DELTA.denominator + EPOCH_LENGTH_MAX_DELTA.numerator)
            // EPOCH_LENGTH_MAX_DELTA.denominator
        )
        proposed = maximum_lawful // PHASE_DENOMINATOR * PHASE_DENOMINATOR
        proposed = min(EPOCH_LENGTH_MAX, proposed)
        if proposed <= live:
            raise BondError("epoch.length upward lattice made no progress")
        values.add(proposed)
        live = proposed
    return tuple(sorted(values))


@dataclass(frozen=True)
class LatencySweepRow:
    """One lawful §11 configuration and the griefing lock it actually needs."""

    epoch_length_blocks: int
    orc_window_blocks: int
    orc_rounds: int
    bond_bps: int
    deadline_days: Fraction
    last_live_round: int

    @property
    def key(self) -> str:
        return (
            f"epoch.length={self.epoch_length_blocks},"
            f"orc.window={self.orc_window_blocks},orc.rounds={self.orc_rounds}"
        )

    @property
    def ok(self) -> bool:
        """Whether every configured ladder round can close by the deadline."""
        return self.last_live_round == self.orc_rounds

    @property
    def full_ladder_bps(self) -> int:
        """The §6.3 rate associated with the configured full ladder."""
        return (2**self.orc_rounds - 1) * self.bond_bps

    @property
    def griefing_lock_bps(self) -> int:
        """Stack a griefer must post before the deadline catches the next round."""
        return (2**self.last_live_round - 1) * self.bond_bps

    @property
    def griefing_discount_ratio(self) -> Fraction:
        """Full-ladder lock divided by the lock the deadline actually requires."""
        if self.griefing_lock_bps == 0:
            raise BondError("no challenge round closes before the money deadline")
        return Fraction(self.full_ladder_bps, self.griefing_lock_bps)


def latency_sweep(
    epoch_lengths: Iterable[int] | None = None,
    orc_windows: Iterable[int] | None = None,
    orc_rounds: Iterable[int] | None = None,
    *,
    bond_bps: int = BOND_BPS_DEFAULT,
) -> tuple[LatencySweepRow, ...]:
    """The deterministic SQ-553 sweep, or the caller's supplied lawful box.

    Defaults are the 13-point `epoch.length` max-Δ lattice, every whole-day
    point in `orc.window`'s 72 h…120 h range, and all three integer round
    counts: 13 × 3 × 3 = 117 rows. The one-day window grid does not pretend
    intermediate block values are unlawful; monotonicity means the grid
    contains both window bounds and every threshold-crossing direction.
    """
    lengths = (
        epoch_length_max_delta_lattice()
        if epoch_lengths is None
        else tuple(sorted(set(epoch_lengths)))
    )
    windows = (
        ORC_WINDOW_DAY_LATTICE
        if orc_windows is None
        else tuple(sorted(set(orc_windows)))
    )
    rounds = (
        tuple(range(ROUNDS_MIN, ROUNDS_MAX + 1))
        if orc_rounds is None
        else tuple(sorted(set(orc_rounds)))
    )
    if not BOND_BPS_MIN <= bond_bps <= BOND_BPS_MAX:
        raise BondError(
            f"orc.bond_bps {bond_bps} outside [{BOND_BPS_MIN}, {BOND_BPS_MAX}]"
        )
    rows = []
    for epoch_length in lengths:
        for window in windows:
            for round_count in rounds:
                rows.append(
                    LatencySweepRow(
                        epoch_length,
                        window,
                        round_count,
                        bond_bps,
                        money_deadline_days(epoch_length),
                        last_live_round(epoch_length, window, round_count),
                    )
                )
    return tuple(rows)


def worst_case_close_days(stages: tuple[LatencyStage, ...] = LATENCY_STAGES) -> list[int]:
    """§11's third column: cumulative worst-case close, in days after `t0`."""
    closes, running = [], 0
    for stage in stages:
        running += stage.days
        closes.append(running)
    return closes


def budget_days(stages: tuple[LatencyStage, ...] = LATENCY_STAGES) -> int:
    """The maximally delayed path's landing day (§11: d21)."""
    return worst_case_close_days(stages)[-1]


def per_round_extension_budget_days() -> int:
    """§11 rule 3's counterfactual: per-round extensions add 4 d."""
    extra_rounds = sum(
        1 for stage in LATENCY_STAGES if stage.name.startswith("round ") and "quorum" not in stage.name
    )
    return budget_days() + extra_rounds * PER_ROUND_EXTENSION_DAYS


def settles_neutrally(close_day: int) -> bool:
    """§11(2)/I-18: past the money deadline the verdict resolves bonds only."""
    return close_day > MONEY_DEADLINE_DAY


def retain_until_days(track_decision_days: int = 7, track_confirm_days: int = 1) -> int:
    """§11(1)/SQ-492: `retain_until = neutralized_at + (decision + confirm)`.

    A round at `R_max` carrying a live challenge is the one the ordinary close
    crank cannot resolve, so "until a terminal verdict" is *forever* unless a
    deadline ends it. **Disposition at expiry: both stacks are refunded; neither
    is forfeit** — at expiry there is no adjudicated side at all.
    """
    return MONEY_DEADLINE_DAY + track_decision_days + track_confirm_days


def expiry_disposition(reporter_stack: int, challenger_stack: int) -> tuple[int, int, int]:
    """`retain_until` expiry: both stacks refunded, nothing to INSURANCE.

    Returns `(to_reporter, to_challenger, to_insurance)`. §5.5's 40/60 split
    disposes of *the adjudicated-wrong side's* stack, and there is no
    adjudicated side here; taking custody with no finding behind it is the
    unbacked claim the ledger discipline exists to prevent.
    """
    if reporter_stack < 0 or challenger_stack < 0:
        raise BondError("negative stack")
    return reporter_stack, challenger_stack, 0


def amend_params(live: OracleParams, **changes: int) -> OracleParams:
    """Convenience: a proposed parameter set as a delta over the live one."""
    return replace(live, **changes)
