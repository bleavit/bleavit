"""08 §2.6 trading-accuracy rewards — the score, the earning cap, the outcome.

The executable form of the 08 §2.6 arithmetic.  Every quantity below is
re-derived from the architecture text and from the 13 rows that text names.
Nothing here reads runtime source, generated weights, or any implementation
artifact: the module exists so that a disagreement with `trading-rewards-core`
is evidence about the specification rather than an echo of the pallet.

What the module covers, in the order 08 §2.6 states it:

* the four per-market counters of *The score* and its numbered rules 1-3;
* rule 4's three dispositions — realized, annulled and proposal VOID — and the
  fold into the participant's epoch accumulator;
* the earning cap and the reward/debit arithmetic of *Reward and debit*;
* the budget clamp, the forfeit destination and the VIT conversion at claim;
* the wash break-even relation the `rwd.rate` value is derived from, and the
  `mkt.fee` floor at which the rate defense lapses.

Units.  Every USDC figure is an integer count of base units; 02 §1 fixes USDC
at 6 decimals, so one base unit is one µUSDC.  Every VIT figure is an integer
count of base units at 12 decimals.  Rates named `*_ppb` are `Perbill`, the
raw scalar unit 13 rule 8 fixes for that kind, so 1e9 ppb is unity.
`settled_value` and `fee.vit_usdc_rate` are `FixedU64` on the 1e9 grid
(02 §1; 03 §5.2 states `s ∈ [0,1]` at that scale).  No float appears anywhere;
inexact quantities are :class:`fractions.Fraction`.

Rounding.  R-7 rounds against the claimant on every leg: a buy's charge and a
debit round **up**, a sale credit, a settlement credit and a reward round
**down**.  The one place 08 §2.6 leaves the direction unstated is the earning
cap, which bounds the reward and the debit at once and therefore has no single
adverse direction; :func:`earning_cap` floors it and
:func:`check_unstated_roundings` reports the gap.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from fractions import Fraction
from typing import Final

from .registry import REGISTRY
from .spec_values import (
    FEE_VIT_USDC_RATE_MAX,
    FEE_VIT_USDC_RATE_MIN,
    FEE_VIT_USDC_RATE_REF,
)


# --------------------------------------------------------------------------
# Scales and the constants 08 §2.6 restates rather than introduces
# --------------------------------------------------------------------------

#: `Perbill` unity — 13 rule 8's raw scalar unit for a Perbill row.
PERBILL_ONE: Final = 1_000_000_000

#: 03 §5.2's settlement score grid.  `settle_scalar(pid, s)` takes
#: `s ∈ [0,1]` as a `FixedU64` at 1e9, and §6.3 multiplies at that scale, so a
#: branch that settled at 0.6 carries `s = 600_000_000`.  08 §2.6 rule 3 names
#: this grid as `SCORE_SCALE` and requires `settled_value` to be read on it.
SETTLED_VALUE_SCALE: Final = 1_000_000_000

#: 02 §1 — USDC has 6 decimals, so one base unit is one µUSDC.
USDC_BASE_UNITS: Final = 1_000_000

#: 02 §1 — VIT has 12 decimals.
VIT_BASE_UNITS: Final = 1_000_000_000_000

#: 08 §2.6 *Reward and debit*: `rate_headroom` is the top of the
#: `fee.vit_usdc_rate` envelope, which §9 and 13 §1 fix at 10x the kernel
#: reference.  A restatement of an existing bound, never a new constant.
RATE_HEADROOM: Final = 10

def _to_fixed(value) -> int:
    """Place an exact decimal rate on the 1e9 `FixedU64` grid, or refuse."""
    exact = Fraction(value) * SETTLED_VALUE_SCALE
    if exact.denominator != 1:
        raise ValueError(f"{value} is not representable on the 1e9 grid")
    return exact.numerator


#: 13 §1 `fee.vit_usdc_rate`, on the `FixedU64` grid: the documented
#: placeholder reference and the kernel envelope 08 §9 fixes around it.  The
#: envelope's top is what `rate_headroom` restates.
VIT_USDC_RATE_REF_FIXED: Final = _to_fixed(FEE_VIT_USDC_RATE_REF)
VIT_USDC_RATE_MIN_FIXED: Final = _to_fixed(FEE_VIT_USDC_RATE_MIN)
VIT_USDC_RATE_MAX_FIXED: Final = _to_fixed(FEE_VIT_USDC_RATE_MAX)

#: 13 §4 — the four bounds 08 §2.6 *Bounds* constrains the program with.
MAX_PARTICIPANTS: Final = 4_096
MAX_SCORED_MARKETS_PER_ACCOUNT: Final = 196
MAX_BUDGET_AUTHORIZATIONS: Final = 4_096
SCORE_ENTRY_LIFETIME_BLOCKS: Final = 5_256_000


def genesis_param_ppb(key: str) -> int:
    """The genesis value of one 13 §1 Perbill row, in ppb.

    The registry module carries 13 §1 as data; reading it here keeps a single
    home for the values and lets a 13 amendment move every consumer at once.
    """
    record = REGISTRY[key]
    if record.unit != "ppb":
        raise ValueError(f"{key} is not a ppb row (unit {record.unit!r})")
    return record.value


# --------------------------------------------------------------------------
# Rounding helpers.  Exact integers only; no float reaches this module.
# --------------------------------------------------------------------------


def _floor_div(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return numerator // denominator


def _ceil_div(numerator: int, denominator: int) -> int:
    if numerator < 0:
        raise ValueError("ceil_div is defined here for non-negative numerators")
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return -(-numerator // denominator)


def book_fee(base: int, fee_ppb: int) -> int:
    """04 §2's book fee: `ceil(mkt.fee . base)` on a buy cost or sale proceeds.

    The book charges the same rounding on both sides, so the fee is adverse to
    the trader twice — 08 §2.6 rule 2 names that symmetry as the reason a sale
    is credited net.
    """
    if base < 0 or fee_ppb < 0:
        raise ValueError("a fee base and rate are both non-negative")
    return _ceil_div(base * fee_ppb, PERBILL_ONE)


# --------------------------------------------------------------------------
# The score (08 §2.6 *The score*, rules 1-4)
# --------------------------------------------------------------------------


class BranchDisposition(str, Enum):
    """Rule 4's three arms — how the branch a score entry tracks ended."""

    #: The traded branch realized.  Score is `received - spent`.
    REALIZED = "realized"
    #: The traded branch was annulled.  Score is `mirror_principal - spent`
    #: and every `received` credit is discarded.
    ANNULLED = "annulled"
    #: The proposal went VOID.  The entry drops at zero and folds to nothing.
    VOID = "void"


@dataclass
class MarketScore:
    """One account's score entry for one market.

    08 §2.6 *The score*: "the book accumulates three unsigned counters and the
    net branch position".  The counters are `spent`, `received` and
    `mirror_principal`; `book_acquired` is the net branch position, held
    separately per rule 2 so that off-book inventory can be excluded.
    """

    #: Rule 1 — `cost + fee` of every book buy, rounded up.
    spent: int = 0
    #: Rules 2 and 3 — sale proceeds net of fee, plus the settlement credit.
    received: int = 0
    #: Rule 1 — the mirror-branch branch-USDC the trade wrapper leaves with the
    #: buyer, which is `cost` and never `cost + fee` (04 §2: the buy fee is
    #: collected as a complete branch-USDC pair, so no fee leg stays with the
    #: buyer).
    mirror_principal: int = 0
    #: Rule 2 — units acquired through this book and not yet sold out of it.
    book_acquired: int = 0
    #: The block the entry was created at, for the *absolute block-height
    #: timeout* escape.
    created_at: int = 0

    def __post_init__(self) -> None:
        for name in ("spent", "received", "mirror_principal", "book_acquired"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} is an unsigned counter")


def on_buy(score: MarketScore, cost: int, fee: int, quantity: int) -> None:
    """Rule 1 — a buy charges `cost + fee` and credits the mirror principal.

    `cost` and `fee` arrive already rounded up by 04 §2's book
    (`cost = ceil(C(q + d) - C(q))`, `fee = ceil(mkt.fee . cost)`), so the
    rule's own "rounded up" is satisfied by the sum of two ceilings.
    """
    if cost < 0 or fee < 0 or quantity < 0:
        raise ValueError("a buy has non-negative cost, fee and quantity")
    score.spent += cost + fee
    score.book_acquired += quantity
    score.mirror_principal += cost


def on_sell(score: MarketScore, proceeds: int, fee: int, quantity: int) -> int:
    """Rule 2 — credit `proceeds - fee`, but only over the book-acquired part.

    Returns the credited amount.  The covered quantity is
    `min(quantity, book_acquired)`; the credit is the net proceeds scaled by
    that share and rounded down, and `book_acquired` falls by the covered
    quantity.  Proceeds beyond it are ignored, which is what closes the
    off-book hole: a complete branch set created through `split*` and sold
    into the book scores nothing at all.
    """
    if proceeds < 0 or fee < 0 or quantity < 0:
        raise ValueError("a sale has non-negative proceeds, fee and quantity")
    if fee > proceeds:
        raise ValueError("the book withholds the fee from the proceeds")
    covered = min(quantity, score.book_acquired)
    if covered == 0 or quantity == 0:
        return 0
    credit = _floor_div((proceeds - fee) * covered, quantity)
    score.received += credit
    score.book_acquired -= covered
    return credit


def on_settle(score: MarketScore, position: int, settled_value: int) -> int:
    """Rule 3 — credit `min(position, book_acquired) x settled_value`.

    `settled_value` is a fraction of par on the 1e9 grid and is clamped to
    par: a unit of a branch that settled at 0.6 is worth six tenths of a base
    unit.  The product is rounded down.  Returns the credited amount.
    """
    if position < 0 or settled_value < 0:
        raise ValueError("a settlement has a non-negative position and value")
    value = min(settled_value, SETTLED_VALUE_SCALE)
    units = min(position, score.book_acquired)
    credit = _floor_div(units * value, SETTLED_VALUE_SCALE)
    score.received += credit
    return credit


def market_result(score: MarketScore, disposition: BranchDisposition) -> int:
    """Rule 4's signed per-market score.

    Realized: `received - spent`.  Annulled: `mirror_principal - spent`, with
    every `received` credit discarded, which substitutes to `-sum(fee)` over
    the market's buys and is 04 §6.2's G-3 promise restated.  VOID: zero.
    """
    if disposition is BranchDisposition.REALIZED:
        return score.received - score.spent
    if disposition is BranchDisposition.ANNULLED:
        return score.mirror_principal - score.spent
    return 0


def score_entry_expired(created_at: int, now: int) -> bool:
    """The *absolute block-height timeout measured from the score entry's
    creation*, independent of the market's state (13 §4 `ScoreEntryLifetime`).
    """
    if created_at < 0 or now < 0:
        raise ValueError("block heights are non-negative")
    return now - created_at >= SCORE_ENTRY_LIFETIME_BLOCKS


# --------------------------------------------------------------------------
# The fold into the epoch accumulator
# --------------------------------------------------------------------------


@dataclass
class EpochScore:
    """One participant's folded epoch totals, in the same unsigned shape.

    `settle_epoch` reads `net = epoch_received - epoch_spent`, so the fold has
    to place each disposition's two sides into the two counters rather than
    accumulating a signed per-market result.
    """

    spent: int = 0
    received: int = 0

    def net(self) -> int:
        return self.received - self.spent


def fold(
    epoch: EpochScore,
    score: MarketScore,
    disposition: BranchDisposition,
) -> int:
    """`settle_market_score` — fold one settled market and delete the entry.

    Returns the signed contribution.  A VOID entry, and equally an expired
    one, contributes nothing on either side: it "drops at zero and folds to
    nothing".
    """
    if disposition is BranchDisposition.VOID:
        return 0
    epoch.spent += score.spent
    if disposition is BranchDisposition.REALIZED:
        epoch.received += score.received
    else:
        epoch.received += score.mirror_principal
    return market_result(score, disposition)


def fold_expired(epoch: EpochScore) -> int:
    """The timeout escape: an expired entry drops at zero, exactly as VOID."""
    del epoch
    return 0


# --------------------------------------------------------------------------
# Reward and debit (08 §2.6 *Reward and debit, both computed in USDC*)
# --------------------------------------------------------------------------


class OutcomeKind(str, Enum):
    REWARD = "reward"
    DEBIT = "debit"
    NEUTRAL = "neutral"


@dataclass(frozen=True)
class Outcome:
    """What `settle_epoch` applies once, for one participant, for one epoch."""

    kind: OutcomeKind
    amount: int = 0

    @staticmethod
    def reward(amount: int) -> "Outcome":
        return Outcome(OutcomeKind.REWARD, amount)

    @staticmethod
    def debit(amount: int) -> "Outcome":
        return Outcome(OutcomeKind.DEBIT, amount)

    @staticmethod
    def neutral() -> "Outcome":
        return Outcome(OutcomeKind.NEUTRAL, 0)


def earning_cap(snapshot_bond: int, rate_ppb: int) -> int:
    """`cap = snapshot_bond / (r x rate_headroom)`, in USDC base units.

    With `r` a Perbill the exact value is
    `snapshot_bond x PERBILL_ONE / (rate_ppb x RATE_HEADROOM)`.

    An unset or zero rate gives a zero cap, and 08 §2.6 states the consequence
    outright: `settle_epoch` then closes at `Neutral`, so a loss already
    folded is forgiven in full and the bond is released untouched.  That is the
    under-punishing direction, and the subsection accepts it because the
    alternative holds a bond behind a governed row the participant cannot move.

    The cap bounds a reward and a debit at once, so no single rounding
    direction is adverse to the claimant on both legs and 08 §2.6 states none.
    Flooring is the reading taken here; see :func:`check_unstated_roundings`.
    """
    if snapshot_bond < 0 or rate_ppb < 0:
        raise ValueError("a bond and a rate are non-negative")
    if rate_ppb == 0:
        return 0
    return _floor_div(snapshot_bond * PERBILL_ONE, rate_ppb * RATE_HEADROOM)


def epoch_outcome(epoch: EpochScore, snapshot_bond: int, rate_ppb: int) -> Outcome:
    """`settle_epoch(who)` — the reward/debit arithmetic, applied exactly once.

    ```
    net    = epoch_received - epoch_spent
    cap    = snapshot_bond / (r x rate_headroom)
    scored = clamp(net, -cap, +cap)
    scored > 0  ->  accrue r x scored   (rounded down, R-7)
    scored < 0  ->  debit  r x |scored| (rounded up,   R-7)
    ```

    `scored == 0` is the neutral arm.  A zero cap therefore closes at
    `Neutral` whatever the folded score was, which is the zero-rate behaviour
    the subsection spells out.
    """
    cap = earning_cap(snapshot_bond, rate_ppb)
    scored = max(-cap, min(cap, epoch.net()))
    if scored > 0:
        return Outcome.reward(_floor_div(rate_ppb * scored, PERBILL_ONE))
    if scored < 0:
        return Outcome.debit(_ceil_div(rate_ppb * -scored, PERBILL_ONE))
    return Outcome.neutral()


def clamp_reward_to_budget(reward: int, unpromised_remainder: int) -> int:
    """The reward is clamped to the budget's unpromised remainder at rate `r`.

    The rate stays fixed at `r`, so a reward is never more than `r x scored`
    and no pair can draw budget out of proportion to its own score.  The debit
    is deliberately **not** reduced by budget pressure: the two legs draw on
    different pots — the reward on the authorized VIT budget, the forfeit on
    `INSURANCE` — so no conservation identity ever linked them, and any
    per-call scaling factor is orderable by a wash operator.
    """
    if reward < 0 or unpromised_remainder < 0:
        raise ValueError("a reward and a remainder are non-negative")
    return min(reward, unpromised_remainder)


def applied_debit(debit: int, snapshot_bond: int) -> tuple[int, bool]:
    """A debit never drives the bond below zero.

    Returns the amount actually taken and whether the participant is
    suspended.  Taking the whole bond suspends; the forfeited USDC goes to
    `INSURANCE`, the standing destination for USDC taken from an account.
    """
    if debit < 0 or snapshot_bond < 0:
        raise ValueError("a debit and a bond are non-negative")
    if debit >= snapshot_bond:
        return snapshot_bond, True
    return debit, False


def admits_scoring(bond: int, suspended: bool) -> bool:
    """The admission condition is a conjunction: nonzero bond AND not suspended.

    Neither side derives the other.  A sub-minimum top-up leaves a suspended
    participant holding a nonzero bond, and a voluntary `withdraw_bond` leaves
    a retained record at zero bond that was never suspended.
    """
    return bond > 0 and not suspended


# --------------------------------------------------------------------------
# The VIT legs — conversion at claim, and the reserve held back at return
# --------------------------------------------------------------------------


def claim_vit(accrued_usdc: int, vit_usdc_rate_fixed: int) -> int:
    """`claim_rewards()` — convert the accrued USDC figure to VIT once.

    The conversion happens at the live `fee.vit_usdc_rate`, in USDC per VIT on
    the 1e9 `FixedU64` grid, and rounds against the claimant.  Carrying the
    two token scales through (USDC 6 decimals, VIT 12 decimals):

        vit_base = floor(accrued_usdc x 10^6 x 10^9 / rate_fixed)
    """
    if accrued_usdc < 0:
        raise ValueError("an accrual is non-negative")
    if vit_usdc_rate_fixed <= 0:
        raise ValueError("the conversion rate must be positive")
    scale = (VIT_BASE_UNITS // USDC_BASE_UNITS) * SETTLED_VALUE_SCALE
    return _floor_div(accrued_usdc * scale, vit_usdc_rate_fixed)


def reserve_vit(outstanding_usdc: int, vit_usdc_rate_fixed: int) -> int:
    """The VIT a `fund_trading_rewards` return must hold back.

    "The amount returned is the sovereign's VIT balance less the accruals no
    participant has claimed yet."  The reserve rounds up, which is the only
    direction that cannot leave a claim short by the rounding itself.  A
    downward `fee.vit_usdc_rate` amendment between the return and a claim can
    still leave it short, and 08 §2.6 states the consequence as liveness
    rather than solvency: the transfer fails, the accrual survives intact.
    """
    if outstanding_usdc < 0:
        raise ValueError("an accrual is non-negative")
    if vit_usdc_rate_fixed <= 0:
        raise ValueError("the conversion rate must be positive")
    scale = (VIT_BASE_UNITS // USDC_BASE_UNITS) * SETTLED_VALUE_SCALE
    return _ceil_div(outstanding_usdc * scale, vit_usdc_rate_fixed)


# --------------------------------------------------------------------------
# The rate derivation (08 §2.6 *The rate is `rwd.rate`*)
# --------------------------------------------------------------------------

#: The extreme-price factor in the wash derivation: "an extreme price where
#: the winning leg's profit approaches the whole notional `q`" is taken at
#: `0.99q`, so a pair that realizes `net` traded a notional of at least
#: `net / 0.99` and paid its fees on that larger base.
WASH_PROFIT_SHARE: Final = Fraction(99, 100)

#: The pair pays one `mkt.fee` leg on each of the two sides it holds.
WASH_FEE_LEGS: Final = 2


def wash_breakeven_rate_ppb(fee_ppb: int) -> Fraction:
    """The break-even reward rate `2f / 0.99`, exactly, in ppb.

    A pair collects `r x 0.99q` against fees of `2fq`, so the reward rate at
    which the farm stops losing money on fees alone is `2f / 0.99`.  At the
    `mkt.fee` default of 30 bps that is 60.6 bps.
    """
    if fee_ppb < 0:
        raise ValueError("a fee rate is non-negative")
    return Fraction(WASH_FEE_LEGS * fee_ppb, 1) / WASH_PROFIT_SHARE


def wash_fee_floor_ppb(rate_ppb: int) -> Fraction:
    """The `mkt.fee` at which the rate defense lapses: `r x 0.99 / 2`.

    At the adopted 25 bps that is 12.375 bps per leg, and `mkt.fee` is
    PARAM-amendable down to 5 bps — so a fee amendment can retire this defense
    without breaking anything, because the bond is rate-independent and holds
    at any rate.
    """
    if rate_ppb < 0:
        raise ValueError("a reward rate is non-negative")
    return Fraction(rate_ppb, 1) * WASH_PROFIT_SHARE / WASH_FEE_LEGS


def wash_pair_fee_cost(net: int, fee_ppb: int) -> int:
    """The fee a wash pair pays to manufacture a realized `net` of `net`.

    The pair's notional is `net / 0.99` by the extreme-price reading above,
    and it pays `mkt.fee` on each of two legs, so the bill is
    `2 x fee x net / 0.99`.  Floored, which understates the attacker's cost
    and is therefore the conservative direction for an anti-farm bound.

    **This is `2 . f . net / 0.99` and not `2 . f . net`.**  The two differ by
    one per cent, and that per cent is exactly the margin the rate coupling
    `rwd.rate <= 2 . mkt.fee / 0.99` leaves: at the coupling's boundary a pair
    with an unequal bond split collects `r . net` against `2 . f . net`, which
    is the larger figure.  See
    :func:`check_wash_bound_needs_the_notional_factor`.
    """
    if net < 0 or fee_ppb < 0:
        raise ValueError("a notional and a fee rate are non-negative")
    exact = Fraction(WASH_FEE_LEGS * fee_ppb * net, PERBILL_ONE) / WASH_PROFIT_SHARE
    return exact.numerator // exact.denominator


def rate_defense_holds(rate_ppb: int, fee_ppb: int) -> bool:
    """Whether the rate coupling `r <= 2f / 0.99` holds at this pair."""
    return Fraction(rate_ppb) <= wash_breakeven_rate_ppb(fee_ppb)


# --------------------------------------------------------------------------
# Findings accessors
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Finding:
    """One derived observation about the 08 §2.6 text or its adopted values."""

    name: str
    detail: str


def check_rate_defense() -> tuple[Finding, ...]:
    """Whether the adopted `rwd.rate` still sits inside the wash break-even.

    Empty while the relation holds.  It is asserted against the live 13 rows
    rather than the published literal, so a `mkt.fee` amendment that closes
    the margin reports here instead of passing on a stale 60.6 bps.
    """
    fee_ppb = genesis_param_ppb("mkt.fee")
    rate_ppb = genesis_param_ppb("rwd.rate")
    if rate_defense_holds(rate_ppb, fee_ppb):
        return ()
    return (
        Finding(
            "rwd.rate reached the wash break-even",
            f"rwd.rate {rate_ppb} ppb is at or above the "
            f"{wash_breakeven_rate_ppb(fee_ppb)} ppb break-even implied by "
            f"mkt.fee {fee_ppb} ppb; only the bond defense remains",
        ),
    )


def check_fee_floor_retires_the_rate_defense() -> tuple[Finding, ...]:
    """The boundary 08 §2.6 states: `mkt.fee` is amendable below the floor.

    Non-empty by construction and by design.  The subsection says so outright
    — "a fee amendment would silently retire a defense this subsection relies
    on" — so the finding records a reachable state rather than a defect, and
    the accessor exists to keep it visible if the `mkt.fee` bounds move.
    """
    rate_ppb = genesis_param_ppb("rwd.rate")
    fee_record = REGISTRY["mkt.fee"]
    floor = wash_fee_floor_ppb(rate_ppb)
    if Fraction(fee_record.minimum) >= floor:
        return ()
    return (
        Finding(
            "mkt.fee is amendable below the rate-defense floor",
            f"mkt.fee may be amended to {fee_record.minimum} ppb, below the "
            f"{floor} ppb floor the adopted rwd.rate {rate_ppb} ppb needs; the "
            "bond is then the only remaining defense, as 08 §2.6 states",
        ),
    )


def check_unstated_roundings() -> tuple[Finding, ...]:
    """Places where 08 §2.6 fixes a quantity but not its rounding direction.

    Non-empty by design.  Each entry is a reading this module takes and the
    reason no direction is forced; an implementation that rounds the other way
    differs by at most one base unit, and the entries exist so that the choice
    is recorded rather than discovered in a differential.
    """
    return (
        Finding(
            "earning cap rounding is unstated",
            "`cap = snapshot_bond / (r x rate_headroom)` bounds a reward and a "
            "debit at once, so no direction is adverse on both legs; this "
            "module floors it, which is reward-adverse and debit-favourable, "
            "and the debit's real backstop is the bond rather than the cap",
        ),
        Finding(
            "the credited share of a partly covered sale is unstated",
            "rule 2 credits `proceeds - fee` only over the book-acquired part "
            "of the sale; this module prorates by the covered quantity and "
            "floors, which is the claimant-adverse reading of an amount the "
            "rule does not otherwise apportion",
        ),
    )


def check_wash_bound_needs_the_notional_factor() -> tuple[Finding, ...]:
    """The anti-farm bound is false if the pair's fee bill drops the `/0.99`.

    08 §2.6's derivation reads the pair's fees as `2fq` on a notional `q` whose
    realized profit is `0.99q`.  Restating the same bound in terms of the
    realized `net` therefore needs `2 . f . net / 0.99`; using `2 . f . net`
    instead states a bound one per cent tighter than the rate coupling
    guarantees, and the coupling's own boundary falsifies it.

    The accessor returns the witness rather than an assertion, because the
    quantity at fault is a restatement of the spec relation and not the spec
    relation itself.  The witness is the corner of the registry envelope: the
    highest admissible `rwd.rate`, the `mkt.fee` that makes the coupling an
    equality, and a bond split that caps the loser's forfeit far below the
    winner's reward.
    """
    rate_ppb = REGISTRY["rwd.rate"].maximum
    fee_ppb = _ceil_div(99 * rate_ppb, 200)
    net = 1_000_000_000
    bond_winner = 1_000_000_000
    bond_loser = 100_000
    winner = EpochScore(spent=0, received=net)
    loser = EpochScore(spent=net, received=0)
    reward = epoch_outcome(winner, bond_winner, rate_ppb).amount
    debit = epoch_outcome(loser, bond_loser, rate_ppb).amount
    naive_fee = _floor_div(WASH_FEE_LEGS * net * fee_ppb, PERBILL_ONE)
    if reward <= debit + naive_fee:
        return ()
    return (
        Finding(
            "the wash bound is false without the 1/0.99 notional factor",
            f"at rwd.rate {rate_ppb} ppb, mkt.fee {fee_ppb} ppb, net {net}, "
            f"bonds {bond_winner}/{bond_loser}: reward {reward} exceeds "
            f"debit {debit} plus a fee bill of {naive_fee} read as 2.f.net, "
            f"while the specification's own 2.f.net/0.99 is "
            f"{wash_pair_fee_cost(net, fee_ppb)} and the bound holds",
        ),
    )
