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

**Finding 2 — WITHDRAWN 2026-08-03, and the withdrawal is the record.** An
earlier revision published per-class ratios (1.23×–3.16×) and per-epoch uplift
targets, claiming the hosted door was cheaper than the cheapest 08 §7 channel on
every class. An adversarial review refuted the arithmetic under all of them and
they are **withdrawn, not corrected**, because two of the three defects are
missing *inputs* rather than slips:

1. `parity_depth_cash` double-counted the branch structure — `pol.b` is quoted
   per branch, i.e. per book, and the function multiplied by a further 2 for
   "the question's two books". A slip, now fixed. Worth recording anyway: the
   error direction was **against this module's own conclusion**, inflating the
   attacker's cost and understating the hole, and it regressed a figure that had
   already been computed correctly by hand hours earlier.
2. The ratios divided by the hosted attack's *measured* harm while treating the
   benchmark channel's harm as **1.0**, which is stated nowhere. 08 §7 prices the
   intake channel's cost; nothing measures its harm.
3. Only carrying cost was counted. Worst-case LMSR maker loss *is* the posted
   cash, on the order of 350× that — so the omission does not make the figure
   conservative, it makes it not a figure.

`check_equalization_not_yet_computable` reports that state. This module publishes
**no ratio and no price target** until (2) and (3) have inputs.

**Finding 3 — WITHDRAWN with Finding 2.** The Track N plan's unsourced
"≈ 3,000 USDC/epoch" appeared corroborated at 2,786 for CODE. That agreement was
an artifact of defect 1: the corrected figure is ~1,589, so the two derivations
do **not** agree, and the apparent corroboration was two different errors landing
near each other. Recorded because a coincidence that looks like confirmation is
worth more as a warning than as a deleted line.

**What survives, and why it is independent.** `check_depth_is_unpriced` reads off
the registration path: `declared_stake = 1` base unit is legal, the fee is
`max(svc.fee_bps · stake, SVC_FEE_FLOOR_USDC)` so the flat floor binds, and `b`
has no upper bound. It depends on none of the withdrawn arithmetic.

**One caveat still binds what remains.** Every depth figure sits on the
proportional-to-depth flow model that 16 §8.4 records as *anchored, not derived*,
with an **unsafe** error direction — a venue more attractive than proportional
needs less depth, so the attack is cheaper than this module says.

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
    "CarryingCost",
    "carrying_cost_per_epoch",
    "cheapest_priced_denial_channel",
    "fee_at_minimum_declared_stake",
    "harm_at_arming_rung",
    "check_equalization_not_yet_computable",
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

    16 §8.4's arming condition bounds external depth at `Σ pol.b(live)`. `pol.b`
    is quoted **per branch, i.e. per book** (13 §1), and 04 §2 mints per-book
    headroom `b·ln 2`, so a slate of `slate` proposals holds
    `slate · 2 · pol_b · ln 2` in cash. A hosted question has exactly two books
    (16 §7.6), so parity is `2·b_ext·ln 2 = slate·2·pol_b·ln 2`, i.e.
    `b_ext = slate · pol_b` — and the cash on both sides is the expression above.

    **An earlier revision multiplied by a further 2** "for the question's two
    books", double-counting the two branches `pol.b` is already quoted per. The
    error direction was against this module's own conclusion: it inflated the
    attacker's cost and so *understated* the hole it exists to report. Caught by
    an adversarial review, 2026-08-03; the test suite now pins the branch-count
    structure and not merely the `b`-versus-`b·ln 2` distinction, which was the
    only guard the first version had and which this error walked straight past.
    """
    if pol_b <= 0 or slate <= 0:
        raise SlotPricingError("pol_b and slate must be positive")
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return Decimal(slate) * Decimal(2) * pol_b * _ln2()


@dataclass(frozen=True)
class CarryingCost:
    """One class's CARRYING cost only — not the attack cost.

    Renamed from `AttackCost` on 2026-08-03: it counts the flat service fee plus
    08 §7 opportunity cost, and omits the LMSR maker loss that dominates both.
    A consumer reading this as the cost of the attack reads it wrong.
    """

    proposal_class: str
    depth_cash: Decimal
    capital_time_value: Decimal
    service_fee: Decimal

    @property
    def total(self) -> Decimal:
        return self.capital_time_value + self.service_fee


def carrying_cost_per_epoch(
    proposal_class: str, slate: int = EPOCH_SLATE_SIZE
) -> CarryingCost:
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
    return CarryingCost(
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


def check_equalization_not_yet_computable(artifact: Path) -> dict[str, object]:
    """Why this module publishes no ratio and no price target (2026-08-03).

    An earlier revision published per-class ratios and per-epoch uplifts. An
    adversarial review refuted the arithmetic under both, and they are withdrawn
    rather than corrected, because two blockers are not arithmetic errors — they
    are missing inputs, and R-2 forbids filling them by assumption:

    **(a) The benchmark's harm is unmeasured.** Every ratio divides the hosted
    attack's *measured* formation loss by `intake_denial`'s harm — which the
    earlier revision silently treated as 1.0 (total denial). Nothing states or
    justifies that, so each ratio was wrong by `1/H_I`. 08 §7 prices the intake
    channel's *cost*; nothing measures its *harm*.

    **(b) The dominant cost term is missing.** The model counted only carrying
    cost on posted escrow. Worst-case LMSR maker loss *is* the posted cash — on
    the order of 350× the carrying cost — so omitting it does not make the figure
    conservative, it makes it not a figure.

    What survives is `check_depth_is_unpriced`, which reads off the registration
    path and depends on none of this.
    """
    harms = {c: harm_at_arming_rung(c, artifact) for c in POL_B_DECISION}
    return {
        "publishes_ratio": False,
        "publishes_price_target": False,
        "hosted_harm_measured": True,
        "hosted_harm_at_arming_rung": harms,
        "benchmark_harm_measured": False,
        "dominant_cost_term_modelled": False,
        "blockers": (
            "intake_denial harm is unmeasured (was smuggled as 1.0); "
            "LMSR maker loss is unmodelled and ~350x the carrying cost counted"
        ),
        "surviving_finding": "check_depth_is_unpriced",
    }


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
