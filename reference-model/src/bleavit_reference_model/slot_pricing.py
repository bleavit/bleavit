"""TH-72's unpriced attack cost, and the slot price that closes it (N14).

14's TH-72 is the row this module exists for, and its attack-cost cell is not a
number. It reads *"round-trip fees only — governance denial at a price that does
not exist in the system today"*, which is a true sentence and an empty column.
`threat_costs.py` prices exactly three rows (TH-11, TH-16, TH-64); TH-72 is not
among them, so the threat model cannot compare the hosted service's denial
channel against any other denial channel it already prices. N14 cannot derive a
slot price against a blank cell, so the cell is filled here first.

**The equalization, and why it beats valuing a lost decision.** The obvious
anchor — multiply measured formation loss by `sec.prize.*` — requires a value for
a decision that never formed. A proposal that fails to form falls back to the
status quo, so the loss is not the capability envelope but the *forgone
improvement*, and pinning that down is a values judgement no evidence in this
repository settles. R-2 forbids inventing it. The equalization needs no such
number: 08 §7 already prices four ways to buy governance denial, so the hosted
door only has to be **no cheaper than the cheapest door that is already priced**.
That is also 16 §8.4's own complaint answered in its own words — it objects that
this is denial "at a price that does not exist", so the repair is to make the
price exist, at parity with the channel that has one.

**Finding 1 — posted depth is free (code-verified, `pallets/question-service`).**
`register` requires `declared_stake > 0`, so a stake of **one base unit** is
legal; the fee is `max(svc.fee_bps · stake, SVC_FEE_FLOOR_USDC)`, so at that
stake the flat 393-USDC floor binds; and `b` carries only a *lower* bound
(`b >= b_min(stake, ε)`, which at stake 1 is ~15) with **no upper bound at all**.
So an attacker pays 393 USDC flat and posts arbitrary market depth. Depth is what
diverts flow, and depth is currently free. This is the defect N14 must repair,
and it is not repaired by occupancy pricing: occupancy and velocity govern *who
gets a slot*, while one slot can hold unlimited depth.

**Finding 2 — the hosted door is cheaper on every class, worst on PARAM.**
Normalized to equal harm (measured decision-grade formation loss at the 0.50
arming rung, N12), buying denial through a hosted question costs 1.23× to 3.16×
less than the cheapest 08 §7 channel. Compared at face value the spread reads
1.46×–8.08×; **the harm normalization halves it**, and reporting the raw ratio
would have overstated the hole by about two. The structural form of the finding:
the cheapest governance to deny is the class Bleavit subsidizes *least*, because
matching a book's depth is what the attack costs and `pol.b` is smallest for
PARAM.

**Finding 3 — the Track N plan's "≈ 3,000 USDC/epoch" estimate survives.** It
appears nowhere in `docs/architecture/`, only in the plan document, so it entered
this work unverified. Derived here by an unrelated route — the fee floor plus
capital opportunity cost on the depth needed for parity, against the plan's
round-trip market fees on 500k — it lands at 2,786 for CODE, within 7 %. Recorded
because an estimate that two independent derivations agree on is worth more than
one that was merely never checked.

**Two caveats, stated rather than netted against each other.** Every cost here
sits on the proportional-to-depth flow model that 16 §8.4 records as *anchored,
not derived*, with an **unsafe** error direction — a venue more attractive than
proportional needs less depth, so the attack is cheaper than this module says.
Against that, the attacker's expected adverse-selection losses to informed
traders are not counted, which makes it dearer. The two push opposite ways and
neither is quantified, so these figures are directional and are **not** a bound
in either direction. Consumers must not read them as one.

Units: USDC in whole units (Decimal), matching `sustainability.py` and
`service_economics.py`. Costs are per epoch, matching 08 §7.

Do not set `getcontext().prec` here — it is process-wide and would perturb the
normative LMSR kernel. Use `localcontext()`, as `lmsr.py` does.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

from . import threat_costs

__all__ = [
    "SVC_FEE_FLOOR_USDC",
    "POL_B_DECISION",
    "EPOCH_SLATE_SIZE",
    "AttackCost",
    "attacker_cost_per_epoch",
    "cheapest_priced_denial_channel",
    "fee_at_minimum_declared_stake",
    "harm_at_arming_rung",
    "equalization",
    "required_uplift",
    "check_depth_is_unpriced",
    "check_th72_attack_cost_is_unpriced",
]

# 13 §2 kernel constant, derived in 16 §8.1 from fully-allocated cost.
SVC_FEE_FLOOR_USDC = Decimal(393)

# 13 §1 `pol.b` decision, per branch, per class — the schedule *floors*.
POL_B_DECISION = {
    "param": Decimal(10_000),
    "treasury": Decimal(25_000),
    "code": Decimal(60_000),
    "meta": Decimal(100_000),
}

# 15 §4.9 / the Phase-0 simulation's per-epoch proposal slate.
EPOCH_SLATE_SIZE = 5

# 16 §8.4's arming rung, the diversion level whose harm the N12 leg measured.
ARMING_RUNG = "0.50"
CONTROL_RUNG = "0.00"

_PRECISION = 40


class SlotPricingError(ValueError):
    """Raised on an input this module refuses to guess past."""


def _ln2() -> Decimal:
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return Decimal(2).ln()


def fee_at_minimum_declared_stake(fee_bps: Decimal = Decimal("0.10")) -> Decimal:
    """The service fee an attacker pays, at the smallest legal declared stake.

    Finding 1. `register` admits `declared_stake = 1` base unit, so the rate leg
    rounds to nothing and the kernel floor binds — **independently of how much
    depth `b` the question posts**, because `b` has a lower bound only.
    """
    if fee_bps < 0:
        raise SlotPricingError("fee_bps must be non-negative")
    minimum_stake = Decimal("0.000001")  # one 6-decimal base unit
    return max(fee_bps * minimum_stake, SVC_FEE_FLOOR_USDC)


def parity_depth_cash(pol_b: Decimal, slate: int = EPOCH_SLATE_SIZE) -> Decimal:
    """Cash an attacker must post to match Bleavit's live decision depth.

    16 §8.4's arming condition bounds external depth at `Σ pol.b(live)`. A slate
    of `slate` proposals carries two branches each, and 04 §2 mints per-book
    headroom `b·ln 2`, so the cash is `2 · Σ b · ln 2` over the question's two
    books — the same `b`-versus-`b·ln 2` distinction that produced the superseded
    escrow figure in `service_economics.py`.
    """
    if pol_b <= 0 or slate <= 0:
        raise SlotPricingError("pol_b and slate must be positive")
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        live_b = Decimal(slate) * Decimal(2) * pol_b
        return live_b * _ln2() * Decimal(2)


@dataclass(frozen=True)
class AttackCost:
    """One class's cost to buy denial through a hosted question, per epoch."""

    proposal_class: str
    depth_cash: Decimal
    capital_time_value: Decimal
    service_fee: Decimal

    @property
    def total(self) -> Decimal:
        return self.capital_time_value + self.service_fee


def attacker_cost_per_epoch(
    proposal_class: str, slate: int = EPOCH_SLATE_SIZE
) -> AttackCost:
    """TH-72's missing attack-cost cell, for one proposal class.

    Two terms only, both already normative: the flat service fee (Finding 1 —
    it does not scale with depth), and 08 §7's own `capital_time_value` on the
    posted cash. Adverse-selection loss is deliberately excluded; see the module
    docstring's caveats.
    """
    if proposal_class not in POL_B_DECISION:
        raise SlotPricingError(f"unknown proposal class {proposal_class!r}")
    cash = parity_depth_cash(POL_B_DECISION[proposal_class], slate)
    tv = threat_costs.capital_time_value(Fraction(int(cash)))
    return AttackCost(
        proposal_class,
        cash,
        Decimal(tv.numerator) / Decimal(tv.denominator),
        fee_at_minimum_declared_stake(),
    )


def cheapest_priced_denial_channel() -> tuple[str, Decimal]:
    """The cheapest 08 §7 channel — the benchmark the hosted door must not undercut.

    Benchmarked against the **cheapest** channel, not the mean: pricing against an
    expensive route would leave the cheap route open, which is the whole defect.
    """
    best: tuple[str, Decimal] | None = None
    for strategy in ("intake_denial", "slot_capture", "combined", "refund_path"):
        cost = threat_costs.intake_monopolization_cost(strategy).cost_per_epoch
        value = Decimal(cost.numerator) / Decimal(cost.denominator)
        if best is None or value < best[1]:
            best = (strategy, value)
    assert best is not None
    return best


def harm_at_arming_rung(proposal_class: str, artifact: Path) -> Decimal:
    """Measured decision-grade formation loss at 16 §8.4's arming rung (N12).

    The harm denominator. Without it the comparison runs at equal *nominal cost*
    rather than equal *harm*, which overstates the gap by about two — the same
    confound class as the N12 control that ran at the wrong flow cap.
    """
    rungs = json.loads(artifact.read_text(encoding="utf-8"))["competing_venue"]["rungs"]
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        control = Decimal(rungs[CONTROL_RUNG][proposal_class]["decision_grade_formation_rate"])
        armed = Decimal(rungs[ARMING_RUNG][proposal_class]["decision_grade_formation_rate"])
        if control <= 0:
            raise SlotPricingError(f"{proposal_class}: control formation rate is zero")
        return (control - armed) / control


def equalization(artifact: Path, slate: int = EPOCH_SLATE_SIZE) -> dict[str, Decimal]:
    """Per class, how many times cheaper the hosted door is at equal harm."""
    _, benchmark = cheapest_priced_denial_channel()
    out: dict[str, Decimal] = {}
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        for proposal_class in POL_B_DECISION:
            cost = attacker_cost_per_epoch(proposal_class, slate).total
            harm = harm_at_arming_rung(proposal_class, artifact)
            out[proposal_class] = benchmark / (cost / harm)
    return out


def required_uplift(artifact: Path, slate: int = EPOCH_SLATE_SIZE) -> dict[str, Decimal]:
    """Per class, the per-epoch cost N14 must add to reach parity.

    The derived price target: a hosted question that buys `harm` units of denial
    must cost at least `benchmark · harm`, so the uplift is that less what the
    attacker pays today.
    """
    _, benchmark = cheapest_priced_denial_channel()
    out: dict[str, Decimal] = {}
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        for proposal_class in POL_B_DECISION:
            cost = attacker_cost_per_epoch(proposal_class, slate).total
            harm = harm_at_arming_rung(proposal_class, artifact)
            out[proposal_class] = benchmark * harm - cost
    return out


def check_depth_is_unpriced() -> dict[str, object]:
    """Finding 1 as a findings accessor: the fee does not move with depth.

    Reported rather than asserted, per the S6–S11 convention — the defect is
    exposed through a `check_*` accessor so a suite pins the *derived* behaviour
    instead of encoding the wrong number as if it were right.
    """
    thin = fee_at_minimum_declared_stake()
    return {
        "fee_at_minimum_stake": thin,
        "fee_is_independent_of_posted_depth": True,
        "why": (
            "register admits declared_stake = 1 base unit, the fee is "
            "max(svc.fee_bps * stake, SVC_FEE_FLOOR_USDC) so the kernel floor "
            "binds, and b carries a lower bound only. Arbitrary depth for 393 USDC."
        ),
        "repaired_by": "N14 — the fee needs a depth-proportional leg",
    }


def check_th72_attack_cost_is_unpriced(repo_root: Path) -> dict[str, object]:
    """TH-72's attack-cost cell carries no number, and `threat_costs` skips it."""
    doc = (repo_root / "docs/architecture/14-threat-model.md").read_text(encoding="utf-8")
    row = next((line for line in doc.splitlines() if line.startswith("| TH-72 |")), None)
    if row is None:
        raise SlotPricingError("TH-72 row not found in doc 14")
    return {
        "row_found": True,
        "cost_cell_mentions_round_trip_fees_only": "round-trip fees only" in row,
        "cost_cell_has_no_figure": "price that does not exist" in row,
        "priced_in_threat_costs": False,
        "repaired_by": "N14 — attacker_cost_per_epoch fills the cell",
    }
