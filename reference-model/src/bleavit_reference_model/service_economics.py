"""16 §5.2, §8 and 08 §10's instrument D — the hosted service's economics as
executable arithmetic.

08's preamble makes this mandatory rather than optional: "all worked arithmetic is
shown and MUST be reproduced by the Phase-0 reference model". `sustainability.py`
discharged that for §10.1–§10.6, but **instrument D was left as prose** — the one
revenue instrument D-20 added, and the only one whose rate is a governed value
rather than a derivation. Every figure below was hand-computed in 16 §8.2 and 13
§1 and nothing re-derived it, which is precisely the state that shipped two wrong
tables in §10 before E5 (SQ-531) and a `2·b_min` escrow figure in this very
section before its 2026-08-01 correction.

Everything here is a *derivation* from the 13 §1/§2 registry and the 16 §5.2/§8.2
formulas. Exactly one input is chosen rather than derived, and it is chosen by the
user: `svc.fee_bps`, adopted at 1,000 bps on 2026-08-02. R-2 permits that because
the row is a market price for a service nobody has sold, so no evidence in this
repository could anchor it; the escalation clause applies and the value is
recorded with its authority instead of being reverse-engineered into a false
derivation. Everything downstream of it *is* derived.

Two subtleties worth stating, because both are places a reader would otherwise
have to guess:

**`b_min` uses the absorption form, not the displacement form.** 16 §5.2 pins
`b_min(S, ε) = ceil(3S / (2·ln(0.5 / (0.5 − ε))))`. An earlier draft used
`ln((0.5 + ε) / (0.5 − ε))`, which 16 §5.2's own table now marks "superseded
(displacement form — do not use)". The two differ by more than a factor of two at
ε = 0.05 — 14.2368·S against 7.47494·S — so picking the wrong one silently halves
the escrow a certified question must post. (16 §5.2's table shows the superseded
figure as 7.48 because, as its own note says, every two-decimal figure there is
rounded **up**; 7.47494 to four places is 7.4749, which is what the suite pins.
An earlier revision of this docstring said 7.4750 and was simply wrong.)
This module implements the pinned form
and the test suite asserts the superseded one does NOT reproduce the published
figure, so the distinction cannot quietly regress.

**The posted cash is `b·ln 2` per book, not `b`.** 04 §2 mints "per-book headroom
`b·ln 2`" and §3 sizes `b = SubsidyBudget / ln 2`. Conflating the LMSR liquidity
parameter with the cash funding it is what produced the superseded `2·b_min =
28.5·S`; the correction *raised* instrument D's share rather than lowering it.

Units: USDC in whole units (Decimal, 6-decimal base unit), matching
`sustainability.py`. `S` is the client's declared stake in USDC.
"""

from __future__ import annotations

import math
from decimal import Decimal

# No `getcontext().prec = ...` here, deliberately. Setting the precision at
# import time mutates the process-wide Decimal context and would silently
# change the arithmetic of every other module in this package, including the
# normative LMSR kernel — the defect `lmsr.py` avoids with `localcontext()` and
# that `test_imports_do_not_mutate_global_decimal_context` exists to catch. It
# caught this module on its first run.
#
# Nothing here needs elevated precision in any case: `_ln` goes through float
# `math.log`, which caps the achievable accuracy at ~17 significant digits, and
# every other operation is a multiply or divide over modest magnitudes. The
# 28-digit default is comfortably above what the inputs can support, so raising
# it would buy precision the values do not have.

# ---------------------------------------------------------------------------
# Registry inputs (13 §1 values, 13 §2 kernel constants). None is chosen here.
# ---------------------------------------------------------------------------

#: `svc.fee_bps`, adopted at 1,000 bps (= 10 %) by the user on 2026-08-02.
#: 13 §1 states the row in **bps** while the stored kind is **Perbill** (parts
#: per 1e9) — a 100,000× difference, pinned by `mkt.fee` = 30 bps = 3,000,000 ppb.
SVC_FEE_BPS_PERBILL = 100_000_000
SVC_FEE_RATE = Decimal(SVC_FEE_BPS_PERBILL) / Decimal(10**9)

#: `SVC_FEE_FLOOR_USDC` (13 §2 kernel constant) — the fully-allocated per-question
#: cost floor, frozen at 393 USDC. Derived below rather than trusted.
SVC_FEE_FLOOR = Decimal(393)

#: `ledger.rdm_fee` = 30 bps, and the 16 §8.2 redemption fraction.
LEDGER_REDEEM_FEE = Decimal(3_000_000) / Decimal(10**9)
REDEEMED_FRACTION = Decimal("0.50")

#: Floor-derivation inputs: 13 §1 `svc.max_window`, `mkt.obs_interval`,
#: `keeper.rebate` (post-SQ-531), `svc.max_live`, and 08 §10.1's cost base.
SVC_MAX_WINDOW = 302_400
MKT_OBS_INTERVAL = 10
KEEPER_REBATE = Decimal("0.000255")
SVC_MAX_LIVE = 16
ANNUAL_COST_BASE = Decimal(109_281)

#: 13 §1 states this as **17.39** epochs/yr, and its published 392.75 figure is
#: computed from that rounded value: the exact quotient is 392.758, which 13 §1
#: truncated rather than rounded (392.76). The unrounded 365.25 / 21.0 =
#: 17.392857 gives 392.69 instead. All three ceil to the frozen 393, so the
#: kernel constant is unaffected and this is an imprecision in an intermediate
#: rather than a defect — but it is stated here rather than smoothed over,
#: because the whole point of this module is that nothing in §10's arithmetic
#: should rest on a figure no code re-derives. Both bases are exposed so the
#: reader can see which one the document used.
EPOCHS_PER_YEAR_STATED = Decimal("17.39")
EPOCHS_PER_YEAR_EXACT = Decimal("365.25") / Decimal(21)


def _ln(value: Decimal) -> Decimal:
    return Decimal(str(math.log(float(value))))


LN2 = _ln(Decimal(2))


# ---------------------------------------------------------------------------
# 16 §5.2 — certification sizing
# ---------------------------------------------------------------------------


def b_min(stake: Decimal, epsilon: Decimal) -> Decimal:
    """The liquidity parameter certification forces, 16 §5.2 (absorption form).

    `Certified(ε, S) iff ManipFloor(ε) >= SECURITY_FACTOR · S`, with the kernel's
    `SECURITY_FACTOR = 3`. Rounds UP, against the party relying on the claim.
    """
    denominator = 2 * _ln(Decimal("0.5") / (Decimal("0.5") - epsilon))
    # Ceil the Decimal quotient directly. Routing it through `float` first --
    # as an earlier revision did -- silently rounds DOWN once the quotient
    # exceeds float's 53-bit mantissa: at stake 10,000,005,521 and eps 0.05 it
    # returns ...317 where the exact ceiling is ...318. One unit is trivial in
    # absolute terms and the direction is not: R-7 puts rounding against the
    # party relying on the claim, and here that is the client's counterparty,
    # so a short b_min underfunds the certification it certifies.
    return Decimal(math.ceil(3 * stake / denominator))


def b_min_superseded(stake: Decimal, epsilon: Decimal) -> Decimal:
    """The displacement form 16 §5.2 marks "do not use".

    Kept solely so the test suite can assert it does NOT reproduce the published
    escrow, because the two differ by ~1.9× and confusing them halves the capital
    a certified question must post.
    """
    denominator = 2 * _ln(
        (Decimal("0.5") + epsilon) / (Decimal("0.5") - epsilon)
    )
    return Decimal(math.ceil(3 * stake / denominator))


def client_subsidy(stake: Decimal, epsilon: Decimal) -> Decimal:
    """Cash the client posts across BOTH books, 16 §8.2: `2 · b_min · ln 2`."""
    return 2 * b_min(stake, epsilon) * LN2


# ---------------------------------------------------------------------------
# 08 §10 — the revenue instruments that are evidenced rather than hypothesised
# ---------------------------------------------------------------------------


def instrument_b(stake: Decimal, epsilon: Decimal) -> Decimal:
    """`ledger.redeem_fee` on the client's own posted escrow (16 §8.2)."""
    return client_subsidy(stake, epsilon) * LEDGER_REDEEM_FEE * REDEEMED_FRACTION


def instrument_d(stake: Decimal) -> Decimal:
    """The two-part tariff, 16 §8.1: `max(svc.fee_floor, svc.fee_bps · S)`.

    Charged once per QUESTION, not per market — a question carries two books, and
    a per-market reading would charge 2× what the arithmetic justifies.
    """
    return max(SVC_FEE_FLOOR, SVC_FEE_RATE * stake)


def floor_crossover() -> Decimal:
    """The stake at which the rate leg overtakes the floor leg.

    At the adopted 1,000 bps this is 3,930 USDC, so for any consequential
    question the rate leg is the entire price and the floor never binds.
    """
    return SVC_FEE_FLOOR / SVC_FEE_RATE


def instrument_d_share(stake: Decimal, epsilon: Decimal) -> Decimal:
    """D as a fraction of *evidenced* per-question revenue (D + B).

    Deliberately excludes instrument A (trading fees on external order flow).
    A is the larger term IF external traders show up, and this repository has no
    evidence that they will — 15 §4.9's simulation cannot test the demand
    hypothesis because its flow is keyed to `dec.v_min`. Including A here would
    turn a hypothesis into a forecast, which 08 §10 forbids.
    """
    d = instrument_d(stake)
    b = instrument_b(stake, epsilon)
    return d / (d + b)


# ---------------------------------------------------------------------------
# 13 §1 — the fee floor's own derivation
# ---------------------------------------------------------------------------


def marginal_cost_per_question() -> Decimal:
    """Keeper crank load over a full-epoch window: `2 · ceil(W / obs) · rebate`.

    This is what the floor is deliberately NOT anchored to. Pricing a scarce slot
    at marginal cost prices it at approximately zero, and the slot is scarce by
    construction — `svc.max_live` is bounded by the 16 §8.5 resource partition,
    not by demand.
    """
    observations = Decimal(math.ceil(SVC_MAX_WINDOW / MKT_OBS_INTERVAL))
    return 2 * observations * KEEPER_REBATE


def fully_allocated_cost_per_question(
    epochs_per_year: Decimal = EPOCHS_PER_YEAR_STATED,
) -> Decimal:
    """`C / (svc.max_live · epochs_per_year)` — what the floor IS anchored to."""
    return ANNUAL_COST_BASE / (Decimal(SVC_MAX_LIVE) * epochs_per_year)
