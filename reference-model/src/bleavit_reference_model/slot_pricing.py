"""What a hosted question actually costs, and what this module may not claim (N14).

**Read the withdrawal notice before using anything here.** Two successive
adversarial reviews refuted most of what this module originally asserted. It is
kept, corrected, because the refutations are the useful part: each one is a way
the hosted service looked cheaper or more dangerous than it is.

**Refuted claim A — "a flat 393 USDC buys arbitrary market depth."** Wrong, and
wrong in a way this module's own arithmetic contradicted. The *fee* really is
flat in depth: `register` admits `declared_stake = 1` base unit, so
`max(svc.fee_bps · stake, SVC_FEE_FLOOR_USDC)` collapses to the 393-USDC floor
however large `b` is. But depth is not bought with the fee. Registration derives
`escrow = 2 · seed_headroom(b) = 2·b·ln 2`, the funder must actually hold it, and
it is checked against the Phase-3 TVL cap. Under the documented 2,000,000-USDC
cap, depth tops out at `b ≈ 1,442,695 USDC`. So the precise, surviving statement
is narrow: **the fee does not scale with depth; the capital requirement does.**
Whether flat *fees* on unbounded depth is a defect is a live question, but it is
not the "depth is free" headline this module shipped.

**Refuted claim B — the equalization benchmark.** The original anchor priced the
hosted denial channel against the cheapest 08 §7 channel (`intake_denial`,
6,400 USDC/epoch). The two deny **different things**. Intake denial blocks
*admission* — it fills the 64-entry queue so new submissions get `IntakeFull` —
and cannot block the decision call for a proposal already in `Trading`. Depth
thinning attacks exactly that already-admitted proposal, driving contest capital
under the per-book floor to `Insufficient` and then `Reject(NotDecisionGrade)`.
Crowding a queue and starving a live decision are not the same harm, so the
cheaper one is not a valid price for the other. The benchmark is removed rather
than re-pointed: `slot_capture` is closer in kind but is a different strategy at
a different price, and choosing between them is exactly the judgement that needs
evidence this repository does not have.

**What that leaves.** This module publishes **no ratio, no benchmark and no price
target**. It publishes the cost structure of a hosted registration — which legs
scale with depth and which do not — plus findings accessors naming what is
missing. N14's case for demand-responsive pricing rests on *allocation* (denying
slot sniping and first-come-first-served under contention), which needs none of
this; the separate claim that hosted denial is **underpriced** is unsubstantiated
and must not be asserted until a commensurable benchmark exists.

**One finding that outlived every refutation, and it is the largest.** 16 §8.4
makes `Σ b_ext ≤ Σ pol.b(live)` a normative arming condition. **No code enforces
it.** `b_ext` appears in no pallet and in no migration; the Phase-4 transition
applies the treasury arming gate and the cap plan and nothing else. N12 spent a
full calibration run measuring governance damage *at* that condition and recorded
its error direction as unsafe — while nothing makes the condition true. Tracked
separately; see `check_arming_condition_unenforced`.

Units: USDC in whole units (Decimal). Costs are per epoch, matching 08 §7.

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
    "fee_at_minimum_declared_stake",
    "harm_at_arming_rung",
    "PHASE3_TVL_CAP_USDC",
    "max_depth_under_tvl_cap",
    "check_fee_is_flat_in_depth",
    "check_no_valid_denial_benchmark",
    "check_arming_condition_enforcement",
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

# 13 §1 phase3.tvl_cap — the bound that actually limits posted depth.
PHASE3_TVL_CAP_USDC = Decimal(2_000_000)

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


def max_depth_under_tvl_cap(cap: Decimal = None) -> Decimal:
    """Largest `b` a single hosted question can post, bounded by the TVL cap.

    `escrow = 2 · seed_headroom(b) = 2·b·ln 2` must fit under `phase3.tvl_cap`
    (13 §1), so `b <= cap / (2·ln 2)`. This is the bound that refutes the
    "arbitrary depth" claim: the fee is flat, the capital is not.
    """
    ceiling = PHASE3_TVL_CAP_USDC if cap is None else cap
    if ceiling <= 0:
        raise SlotPricingError("cap must be positive")
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return ceiling / (Decimal(2) * _ln2())


def check_fee_is_flat_in_depth() -> dict[str, object]:
    """The surviving, narrowed form of the original headline claim.

    The original said 393 USDC buys arbitrary depth. It does not — depth is
    bought with escrow, which scales as `2·b·ln 2` and is TVL-capped. What is
    true is only that the *fee leg* is invariant in `b`.
    """
    return {
        "fee_at_minimum_stake": fee_at_minimum_declared_stake(),
        "fee_scales_with_depth": False,
        "capital_scales_with_depth": True,
        "escrow_formula": "2 * seed_headroom(b) = 2*b*ln 2",
        "max_b_under_phase3_tvl_cap": max_depth_under_tvl_cap(),
        "superseded_claim": "393 USDC buys arbitrary depth — REFUTED 2026-08-03",
        "open_question": (
            "whether a fee flat in depth is itself a defect, given the capital "
            "requirement is not — unresolved, and not asserted either way here"
        ),
    }


def check_no_valid_denial_benchmark() -> dict[str, object]:
    """Why this module publishes no ratio and no price target.

    `intake_denial` blocks admission (the 64-entry queue, `IntakeFull`); depth
    thinning starves a proposal already in `Trading` into
    `Reject(NotDecisionGrade)`. Different harms, so the cheaper is not a price
    for the other. Two further blockers survive from the first review: the
    benchmark channel's *harm* is unmeasured, and worst-case LMSR maker loss —
    the dominant cost term — is unmodelled.
    """
    return {
        "publishes_ratio": False,
        "publishes_price_target": False,
        "benchmark_removed": "intake_denial — incommensurable harm",
        "blockers": (
            "intake denial blocks admission, not the decision call; benchmark "
            "harm unmeasured; LMSR maker loss unmodelled and dominant"
        ),
        "n14_rationale_that_survives": (
            "allocation — slot sniping and first-come-first-served under "
            "contention — which needs no threat-cost benchmark"
        ),
        "n14_rationale_that_does_not": (
            "that hosted denial is underpriced relative to existing channels"
        ),
    }


def check_arming_condition_enforcement(repo_root: Path) -> dict[str, object]:
    """How much of 16 §8.4's arming condition has an implementer (SQ-575).

    Renamed from `check_arming_condition_unenforced` on 2026-08-03, when the
    tripwire it carried did its job: the earlier version asserted the condition
    was enforced *nowhere*, and it failed the moment the switch-on half shipped.
    Rewritten rather than relaxed, because a tripwire that gets loosened to stay
    green is worse than no tripwire.

    Detects the **mechanism**, not the phrase. An earlier draft searched for the
    string `b_ext`, which appears in prose comments — so a doc-only change would
    have reported the condition enforced. It now looks for the storage item that
    carries the external side and the error that refuses on it.

    Two halves, deliberately reported apart:

    - **switch-on** — 16 §8.4's own wording, checked in the Phase-4 transition.
      Implemented.
    - **continuous** — the same bound held at every registration. NOT
      implemented, and not an oversight: `LivePolCommitments` holds protocol
      subsidy only while decision books are seeded, so the instantaneous
      `Σ pol.b(live)` is zero for most of an epoch and the check would refuse
      essentially every registration outside Bleavit's own decision windows
      (21 of 28 pallet tests failed exactly that way). What non-blinking measure
      it should use instead is not derivable from anything here yet.
    """
    migration = (repo_root / "runtime/bleavit-runtime/src/migrations.rs").read_text(
        encoding="utf-8"
    )
    pallet = (repo_root / "pallets/question-service/src/lib.rs").read_text(
        encoding="utf-8"
    )
    switch_on = (
        "LiveExternalDepth" in migration and "ArmingBoundExceeded" in migration
    )
    external_side_accounted = "LiveExternalDepth" in pallet
    # The continuous half would have to compare at the registration site itself.
    continuous = "ArmingBoundExceeded" in pallet and "live_pol_commitments" in pallet
    return {
        "condition": "sum(b_ext) <= sum(pol.b(live)) (16 §8.4)",
        "external_side_accounted": external_side_accounted,
        "switch_on_enforced": switch_on,
        "continuously_enforced": continuous,
        "fully_enforced": switch_on and continuous,
        "open_half": (
            "continuous enforcement — needs a measure of protocol depth that "
            "does not blink between decision windows; the instantaneous "
            "LivePolCommitments sum cannot be it"
        ),
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
