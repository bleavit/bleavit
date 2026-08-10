"""13 §1, §2 and rule 7 — the registry and its lawful-amendment graph.

This is the whole-registry generalisation of :mod:`occupancy`.  Doc 13 says
that each tunable has typed bounds, a max-Δ rule and a cooldown; rule 7 says
that cross-key relations which a record cannot express bind at the consuming
engine.  15 §1 I-6 makes the exact next-value interval and cooldown normative,
while I-14 and 05 §5 make a gate veto precede every welfare comparison.

Executing those claims finds four distinct failures rather than assuming the
registry box is safe:

* rule 7's ``dec.sigma <= delta/2`` and ``gate.eps <= p_max/2`` relations have
  no consumer validation at all, contrary to the consuming-engine checks the
  document requires.  The welfare-weight identity is consumer-validated as
  required, while the ``gate.v_min`` band and
  ``ledger.redeem_fee <= mkt.fee`` bind earlier at the amendment boundary;
* ``dec.trailing > dec.window`` is reachable in three amendments and four
  elapsed epochs.  Equality remains valid containment, but the two Rust
  consumers disagree there: epoch-core accepts it and pallet-market does not;
* the missing ``gate.p_max`` floor reaches zero in five amendments / twenty
  epochs and then the strict gate veto rejects every market-bearing class.
  At the minimum viable META NAV, ``sec.prize.meta`` reaches a value above the
  largest certificate admitted by the POL budget after one doubling / two
  epochs.  Both states disable the META class which
  owns their repair;
* the reserve-probe first-arm runway is not re-verified after amendments of
  either threshold, fee or conversion rate; the remote USDC inventory check is
  likewise not repeated after ``res.probe_amount`` changes.

The N7 repository artifacts contain **110** seeded keys and **205** classified
limits. Tests byte-check the model's canonical 16-byte keys against both
artifacts, so additions cannot move either count silently.

Values use the raw scalar representation fixed by 13 rule 8 / 02 §4: Fixed
and Perbill are on the 1e9 grid, Percent is an integer percent, Balance uses
the row's native base unit (µUSDC, DOT planck or VIT planck), and integer kinds
use their native unit.  All arithmetic is integer or :class:`~decimal.Decimal`.
Percent allowances round down; factor lower bounds round up; security costs
round down to µUSDC.  Every direction is against the claimant seeking a more
permissive amendment (R-7).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal, localcontext
from enum import Enum
from itertools import product
import os
from pathlib import Path
import re
from typing import Callable, Iterable, Mapping

from .spec_values import (
    EPOCH_LENGTH_DEFAULT,
    EPOCH_LENGTH_MAX,
    EPOCH_LENGTH_MAX_DELTA_PERCENT,
    EPOCH_LENGTH_MIN,
    NAV_FLOOR_CODE,
    NAV_FLOOR_META,
    NAV_FLOOR_PARAM,
    NAV_FLOOR_TREASURY,
)
from .treasury import attack_cost_hat, l_hat, round_down


WORK_PREC = 100
FIXED_SCALE = 1_000_000_000
PERBILL_SCALE = 1_000_000_000
PERBILL_PER_BPS = 100_000
USDC = 1_000_000
VIT = 1_000_000_000_000
DOT = 10_000_000_000
U8_MAX = 2**8 - 1
U32_MAX = 2**32 - 1
U128_MAX = 2**128 - 1
BLOCKS_PER_DAY = 14_400
LN2 = Decimal(
    "0.6931471805599453094172321214581765680755001343602552541206800094933936219696947156058633269964186875"
)


def ceil_div(numerator: int, denominator: int) -> int:
    """Exact integer division rounded up; negative inputs are not registry values."""
    if numerator < 0 or denominator <= 0:
        raise ValueError("ceil_div requires a non-negative numerator and positive divisor")
    return -(-numerator // denominator)


class ParamKind(str, Enum):
    U8 = "u8"
    U32 = "u32"
    FIXED = "Fixed"
    PERBILL = "Perbill"
    PERCENT = "Percent"
    BALANCE = "Balance"


class AmendmentClass(str, Enum):
    PARAM = "PARAM"
    TREASURY = "TREASURY"
    META = "META"
    CONST = "CONST"
    ENTRENCHED = "entrenched"
    META_VALUES = "META+values"


class DeltaKind(str, Enum):
    ABSOLUTE = "Absolute"
    PERCENT = "Percent"
    FACTOR = "Factor"


@dataclass(frozen=True)
class DeltaRule:
    """One 13 §1 max-Δ rule in raw scalar units."""

    kind: DeltaKind
    amount: int

    def __post_init__(self) -> None:
        if self.amount <= 0:
            raise ValueError("a max-delta amount must be positive")


def absolute(amount: int) -> DeltaRule:
    return DeltaRule(DeltaKind.ABSOLUTE, amount)


def percent(amount: int) -> DeltaRule:
    return DeltaRule(DeltaKind.PERCENT, amount)


def factor(amount: int) -> DeltaRule:
    return DeltaRule(DeltaKind.FACTOR, amount)


@dataclass(frozen=True)
class ParamRecord:
    """One materialized 13 §1 record, in the raw units fixed by rule 8."""

    key: str
    kind: ParamKind
    unit: str
    value: int
    minimum: int
    maximum: int
    max_delta: DeltaRule | None
    cooldown_epochs: int
    amendment_class: AmendmentClass
    kernel_bounded: bool

    def __post_init__(self) -> None:
        if not 0 <= self.minimum <= self.value <= self.maximum:
            raise ValueError(f"{self.key}: default outside [min, max]")
        if self.cooldown_epochs < 0:
            raise ValueError(f"{self.key}: negative cooldown")
        param_key_bytes(self.key)

    def admissible_interval(self, live: int | None = None) -> tuple[int, int]:
        """I-6's exact inclusive next-value interval.

        Percent rules floor the symmetric allowance.  Factor rules are
        asymmetric: ``ceil(live/factor)`` below and ``live*factor`` above.
        Both are intersected with the record bounds.
        """
        current = self.value if live is None else live
        if not self.minimum <= current <= self.maximum:
            raise ValueError(f"{self.key}: live value outside record bounds")
        if self.max_delta is None:
            return self.minimum, self.maximum
        rule = self.max_delta
        if rule.kind is DeltaKind.ABSOLUTE:
            low = max(0, current - rule.amount)
            high = min(U128_MAX, current + rule.amount)
        elif rule.kind is DeltaKind.PERCENT:
            allowance = current * rule.amount // 100
            low = max(0, current - allowance)
            high = min(U128_MAX, current + allowance)
        else:
            low = ceil_div(current, rule.amount)
            high = min(U128_MAX, current * rule.amount)
        return max(self.minimum, low), min(self.maximum, high)

    def step_admissible(self, live: int, proposed: int) -> bool:
        low, high = self.admissible_interval(live)
        return low <= proposed <= high


def param_key_bytes(key: str) -> bytes:
    """13 rule 6 canonical ``ParamKey``: UTF-8, zero-padded to 16 bytes."""
    encoded = key.encode("utf-8")
    if len(encoded) > 16:
        raise ValueError(f"ParamKey {key!r} exceeds 16 bytes")
    return encoded.ljust(16, b"\0")


# 13 §1 rule 7's normative and exhaustive kernel-bounded set.
KERNEL_BOUNDED_KEYS = frozenset(
    {
        "att.window",
        "code.spacing",
        "dec.delta.code",
        "dec.delta.meta",
        "dec.delta.param",
        "dec.delta.trs",
        "dec.sigma.code",
        "dec.sigma.meta",
        "dec.sigma.param",
        "dec.sigma.trs",
        "dec.window",
        "epoch.horizon_k",
        "epoch.length",
        "exec.grace",
        "exec.lock.code",
        "exec.lock.meta",
        "exec.lock.param",
        "exec.lock.trs",
        "gate.eps",
        "gate.p_max",
        "intake.slash_pct",
        "iss.inflation",
        "keeper.budget",
        "ledger.archive",
        "ledger.min_split",
        "ledger.pos_dep",
        "mkt.kappa",
        "orc.bond_bps",
        "orc.n_min",
        "orc.window",
        "pol.budget_epoch",
        "res.fail_thr",
        "res.probe_amount",
        "res.probe_int",
        "res.probe_to",
        "res.recover_thr",
        "sec.prize.code",
        "sec.prize.meta",
        "sec.prize.param",
        "svc.max_live",
        "trs.cap_180d",
        "trs.cap_30d",
        "trs.cap_proposal",
        "welfare.thC_lo",
        "welfare.thS_lo",
        "wt.quorum",
    }
)


_records: dict[str, ParamRecord] = {}


def _row(
    key: str,
    kind: ParamKind,
    unit: str,
    value: int,
    minimum: int,
    maximum: int,
    max_delta: DeltaRule | None,
    cooldown: int,
    amendment_class: AmendmentClass,
) -> None:
    if key in _records:
        raise ValueError(f"duplicate registry key {key}")
    _records[key] = ParamRecord(
        key,
        kind,
        unit,
        value,
        minimum,
        maximum,
        max_delta,
        cooldown,
        amendment_class,
        key in KERNEL_BOUNDED_KEYS,
    )


# ---------------------------------------------------------------------------
# 13 §1 materialized records.  Values, bounds, deltas, cooldowns and classes
# are the table's own; em-dash bounds resolve to the stored type's endpoint.
# ---------------------------------------------------------------------------

# Epoch, markets and the decision engine (13 §1; 04 §7; 05 §3/§5).
_row(
    "epoch.length",
    ParamKind.U32,
    "blocks",
    EPOCH_LENGTH_DEFAULT,
    EPOCH_LENGTH_MIN,
    EPOCH_LENGTH_MAX,
    percent(EPOCH_LENGTH_MAX_DELTA_PERCENT),
    2,
    AmendmentClass.META,
)
_row("epoch.slots", ParamKind.U8, "count", 5, 1, 12, absolute(2), 1, AmendmentClass.META)
_row("epoch.horizon_k", ParamKind.U8, "epochs", 2, 1, 2, absolute(1), 4, AmendmentClass.META_VALUES)
_row("mkt.obs_interval", ParamKind.U32, "blocks", 10, 5, 50, absolute(5), 1, AmendmentClass.PARAM)
_row("mkt.kappa", ParamKind.FIXED, "1e-9/interval", 5_000_000, 1_000_000, 20_000_000, absolute(2_000_000), 2, AmendmentClass.META)
_row("mkt.fee", ParamKind.PERBILL, "ppb", 3_000_000, 500_000, 10_000_000, absolute(1_000_000), 1, AmendmentClass.PARAM)
# 13 §1 / 08 §2.6.  The trading-accuracy reward rate, adopted at 0.25 % on
# 2026-08-10.  The ceiling is the largest clean value strictly inside the wash
# break-even `2 * mkt.fee / 0.99`, which is 60.6 bps at the `mkt.fee` default.
# The step is absolute rather than a factor because the floor is zero, and a
# factor rule can never raise a rate that reached its floor.
_row("rwd.rate", ParamKind.PERBILL, "ppb", 2_500_000, 0, 6_000_000, absolute(2_500_000), 1, AmendmentClass.PARAM)
_row("dec.window", ParamKind.U32, "blocks", 43_200, 14_400, 86_400, percent(20), 2, AmendmentClass.META)
_row("dec.trailing", ParamKind.U32, "blocks", 14_400, 3_600, 28_800, None, 2, AmendmentClass.META)
_row("dec.delta_max", ParamKind.FIXED, "1e-9", 50_000_000, 20_000_000, 100_000_000, None, 2, AmendmentClass.META)
_row("dec.coverage", ParamKind.PERCENT, "percent", 95, 90, 99, None, 2, AmendmentClass.META)

for key, value in zip(
    ("dec.delta.param", "dec.delta.trs", "dec.delta.code", "dec.delta.meta"),
    (37_500_000, 37_500_000, 60_000_000, 90_000_000),
):
    _row(key, ParamKind.FIXED, "1e-9 score", value, 5_000_000, 100_000_000, absolute(5_000_000), 2, AmendmentClass.META)

for key, value in zip(
    ("dec.sigma.param", "dec.sigma.trs", "dec.sigma.code", "dec.sigma.meta"),
    (3_000_000, 5_000_000, 8_000_000, 10_000_000),
):
    _row(key, ParamKind.FIXED, "1e-9 score", value, 0, 50_000_000, None, 2, AmendmentClass.META)

for suffix, value in zip(("param", "trs", "code", "meta"), (100_000, 250_000, 600_000, 1_200_000)):
    _row(f"dec.v_min.{suffix}", ParamKind.BALANCE, "µUSDC", value * USDC, value * USDC // 10, value * USDC * 10, factor(2), 2, AmendmentClass.META)

for suffix, decision in zip(("param", "trs", "code", "meta"), (100_000, 250_000, 600_000, 1_200_000)):
    _row(f"gate.v_min.{suffix}", ParamKind.BALANCE, "µUSDC", decision * USDC // 10, decision * USDC // 20, decision * USDC // 2, factor(2), 2, AmendmentClass.META)

# The hard-min em dash on gate.p_max is the Fixed type floor: zero.  This is
# not a policy value invented by the model; it is exactly the absence SQ-546
# exercises against 05 §5.1's strict `>` veto.
_row("gate.p_max", ParamKind.FIXED, "1e-9 probability", 50_000_000, 0, 100_000_000, absolute(10_000_000), 4, AmendmentClass.META_VALUES)
_row("gate.eps", ParamKind.FIXED, "1e-9 probability", 20_000_000, 5_000_000, 50_000_000, None, 2, AmendmentClass.META)
_row("gate.nb_coverage", ParamKind.PERCENT, "percent", 98, 95, 100, None, 2, AmendmentClass.META)
_row("gate.nb_conv", ParamKind.FIXED, "1e-9", 10_000_000, 5_000_000, 20_000_000, None, 2, AmendmentClass.META)

_row("welfare.thS_lo", ParamKind.FIXED, "1e-9", 900_000_000, 900_000_000, FIXED_SCALE, absolute(10_000_000), 4, AmendmentClass.CONST)
_row("welfare.thS_hi", ParamKind.FIXED, "1e-9", 980_000_000, 900_000_000, FIXED_SCALE, absolute(10_000_000), 4, AmendmentClass.CONST)
_row("welfare.thC_lo", ParamKind.FIXED, "1e-9", 850_000_000, 850_000_000, FIXED_SCALE, absolute(10_000_000), 4, AmendmentClass.CONST)
_row("welfare.thC_hi", ParamKind.FIXED, "1e-9", 950_000_000, 850_000_000, FIXED_SCALE, absolute(10_000_000), 4, AmendmentClass.CONST)
_row("welfare.wP", ParamKind.FIXED, "1e-9", 600_000_000, 300_000_000, 700_000_000, absolute(50_000_000), 4, AmendmentClass.CONST)
_row("welfare.wA", ParamKind.FIXED, "1e-9", 400_000_000, 300_000_000, 700_000_000, absolute(50_000_000), 4, AmendmentClass.CONST)

# Governance, execution and treasury rows (13 §1; 06; 08; 09).
for suffix, value in zip(("param", "trs", "code", "meta"), (1_000, 5_000, 25_000, 50_000)):
    _row(f"prop.bond.{suffix}", ParamKind.BALANCE, "µUSDC", value * USDC, value * USDC // 10, value * USDC * 10, factor(2), 2, AmendmentClass.META)

for suffix, value in zip(("param", "trs", "code", "meta"), (2, 3, 7, 14)):
    _row(f"exec.lock.{suffix}", ParamKind.U32, "blocks", value * BLOCKS_PER_DAY, BLOCKS_PER_DAY, 30 * BLOCKS_PER_DAY, factor(2), 2, AmendmentClass.META)

_row("exec.grace", ParamKind.U32, "blocks", 14 * BLOCKS_PER_DAY, 7 * BLOCKS_PER_DAY, 30 * BLOCKS_PER_DAY, None, 2, AmendmentClass.META)
_row("code.spacing", ParamKind.U32, "blocks", 30 * BLOCKS_PER_DAY, 14 * BLOCKS_PER_DAY, U32_MAX, None, 2, AmendmentClass.META)
_row("intake.max_acct", ParamKind.U8, "entries/epoch", 4, 2, 8, absolute(2), 2, AmendmentClass.META)
_row("intake.slash_pct", ParamKind.PERCENT, "percent", 10, 5, 25, absolute(5), 2, AmendmentClass.META)

for suffix, value in zip(("param", "trs", "code", "meta"), (10_000, 25_000, 60_000, 100_000)):
    _row(f"pol.b.{suffix}", ParamKind.BALANCE, "µUSDC", value * USDC, 0, U128_MAX, percent(25), 1, AmendmentClass.TREASURY)
_row("pol.b_gate", ParamKind.BALANCE, "µUSDC", 7_500 * USDC, 0, U128_MAX, percent(25), 1, AmendmentClass.TREASURY)
_row("pol.b_baseline", ParamKind.BALANCE, "µUSDC", 25_000 * USDC, 10_000 * USDC, 100_000 * USDC, percent(25), 1, AmendmentClass.TREASURY)
_row("pol.budget_epoch", ParamKind.PERBILL, "ppb NAV", 7_500_000, 0, 15_000_000, None, 2, AmendmentClass.META)

_row("trs.cap_proposal", ParamKind.PERCENT, "percent NAV", 5, 0, 10, absolute(1), 2, AmendmentClass.META)
_row("trs.cap_30d", ParamKind.PERCENT, "percent NAV", 10, 0, 15, None, 2, AmendmentClass.META)
_row("trs.cap_180d", ParamKind.PERCENT, "percent NAV", 30, 0, 40, None, 2, AmendmentClass.META)
_row("trs.stream_thr", ParamKind.PERBILL, "ppb NAV", 10_000_000, 5_000_000, 50_000_000, None, 2, AmendmentClass.META)

for suffix, value in zip(("param", "trs", "code", "meta"), (500, 25_000, 25_000, 25_000)):
    _row(f"trs.reward.{suffix}", ParamKind.BALANCE, "µUSDC", value * USDC, value * USDC // 10, value * USDC * 10, factor(2), 2, AmendmentClass.META)

_row("iss.inflation", ParamKind.PERCENT, "percent/year", 2, 0, 2, None, 0, AmendmentClass.CONST)
_row("grd.review_dl", ParamKind.U32, "epochs", 2, 1, 4, absolute(1), 2, AmendmentClass.META)
_row("att.bond", ParamKind.BALANCE, "VIT planck", 25_000 * VIT, 12_500 * VIT, 250_000 * VIT, factor(2), 2, AmendmentClass.ENTRENCHED)
_row("att.window", ParamKind.U32, "blocks", 43_200, 43_200, 72_000, None, 2, AmendmentClass.META)

# Oracle, reserve and operating inputs (13 §1; 07 §3–§12; 08 §1.1).
_row("orc.bond_floor", ParamKind.BALANCE, "µUSDC", 10_000 * USDC, 2_500 * USDC, 100_000 * USDC, None, 2, AmendmentClass.META)
_row("orc.bond_bps", ParamKind.PERBILL, "ppb", 250 * PERBILL_PER_BPS, 150 * PERBILL_PER_BPS, 1_000 * PERBILL_PER_BPS, factor(2), 2, AmendmentClass.META)
_row("orc.rounds", ParamKind.U8, "count", 3, 2, 4, None, 2, AmendmentClass.META)
_row("orc.window", ParamKind.U32, "blocks", 43_200, 43_200, 72_000, None, 2, AmendmentClass.META)
_row("orc.rep_stake", ParamKind.BALANCE, "µUSDC", 100_000 * USDC, 25_000 * USDC, 500_000 * USDC, factor(2), 2, AmendmentClass.META)
_row("orc.n_min", ParamKind.U8, "count", 3, 3, 16, absolute(1), 2, AmendmentClass.META)
_row("wt.quorum", ParamKind.U8, "count", 2, 2, 5, absolute(1), 2, AmendmentClass.META)
_row("wt.stake", ParamKind.BALANCE, "µUSDC", 25_000 * USDC, 10_000 * USDC, 100_000 * USDC, factor(2), 2, AmendmentClass.META)
_row("reg.bond_inc", ParamKind.BALANCE, "µUSDC", 5_000 * USDC, 2_500 * USDC, 50_000 * USDC, factor(2), 2, AmendmentClass.META)
_row("reg.bond_mile", ParamKind.BALANCE, "µUSDC", 2_500 * USDC, 1_250 * USDC, 25_000 * USDC, factor(2), 2, AmendmentClass.META)
_row("res.probe_int", ParamKind.U32, "blocks", 14_400, 1, U32_MAX, None, 1, AmendmentClass.PARAM)
_row("res.probe_to", ParamKind.U32, "blocks", 600, 1, U32_MAX, None, 1, AmendmentClass.PARAM)
_row("res.probe_amount", ParamKind.BALANCE, "µUSDC", 100_000, 1, U128_MAX, None, 1, AmendmentClass.PARAM)
_row("res.fail_thr", ParamKind.U8, "probes", 2, 1, U8_MAX, None, 2, AmendmentClass.META)
_row("res.recover_thr", ParamKind.U8, "probes", 3, 1, U8_MAX, None, 2, AmendmentClass.META)
_row("dis.merit_min", ParamKind.BALANCE, "µUSDC", 10_000 * USDC, 10_000 * USDC, U128_MAX, factor(2), 2, AmendmentClass.META)

_row("keeper.budget", ParamKind.BALANCE, "µUSDC", 12_000 * USDC, 6_000 * USDC, 60_000 * USDC, factor(2), 1, AmendmentClass.PARAM)
_row("keeper.rebate", ParamKind.BALANCE, "µUSDC", 255, 85, 850, None, 1, AmendmentClass.PARAM)
_row("collator.comp", ParamKind.BALANCE, "µUSDC/collator", 500 * USDC, 500 * USDC, 10_000 * USDC, factor(2), 1, AmendmentClass.PARAM)
_row("collator.n_min", ParamKind.U8, "count", 4, 3, 12, absolute(1), 2, AmendmentClass.META)
_row("collator.n_tgt", ParamKind.U8, "count", 5, 4, 12, absolute(1), 2, AmendmentClass.META)

_row("ops.ct_dot_rate", ParamKind.BALANCE, "µUSDC/DOT", 5_000_000, 500_000, 500_000_000, factor(2), 1, AmendmentClass.TREASURY)
_row("ops.ct_fee_dot", ParamKind.BALANCE, "DOT planck", 5_000_000_000, 100_000_000, 100_000_000_000, factor(2), 1, AmendmentClass.TREASURY)
_row("ops.probe_fee", ParamKind.BALANCE, "DOT planck", 5_000_000_000, 100_000_000, 100_000_000_000, factor(2), 1, AmendmentClass.TREASURY)
_row("ops.probe_rate", ParamKind.BALANCE, "µUSDC/DOT", 5_000_000, 500_000, 500_000_000, factor(2), 1, AmendmentClass.TREASURY)
_row("ops.ct_quote_ttl", ParamKind.U32, "blocks", 100_800, 7_200, 403_200, factor(2), 1, AmendmentClass.TREASURY)

# Ledger, security, phase caps and XCM rates (13 §1; 03; 05 §5.6; 09).
_row("ledger.min_split", ParamKind.BALANCE, "µUSDC", 10_000, 10_000, USDC, None, 2, AmendmentClass.META)
_row("ledger.rdm_fee", ParamKind.PERBILL, "ppb", 3_000_000, 0, 10_000_000, absolute(1_000_000), 1, AmendmentClass.PARAM)
_row("ledger.archive", ParamKind.U32, "blocks", 365 * BLOCKS_PER_DAY, 90 * BLOCKS_PER_DAY, 365 * BLOCKS_PER_DAY, None, 2, AmendmentClass.META)
_row("ledger.pos_dep", ParamKind.BALANCE, "µUSDC", 100_000, 100_000, 100_000, None, 2, AmendmentClass.META)

for suffix, value in (("param", 50_000), ("code", 300_000), ("meta", 600_000)):
    _row(f"sec.prize.{suffix}", ParamKind.BALANCE, "µUSDC", value * USDC, value * USDC, U128_MAX, factor(2), 2, AmendmentClass.META)
_row("sec.flow_cap", ParamKind.FIXED, "1e-9 multiple", 16 * FIXED_SCALE, 7 * FIXED_SCALE, 32 * FIXED_SCALE, factor(2), 2, AmendmentClass.META)

_row("phase3.tvl_cap", ParamKind.BALANCE, "µUSDC", 2_000_000 * USDC, 0, U128_MAX, None, 0, AmendmentClass.META_VALUES)
_row("phase3.dep_cap", ParamKind.BALANCE, "µUSDC", 20_000 * USDC, 0, U128_MAX, None, 0, AmendmentClass.META_VALUES)

_row("xcm.dot_per_sec", ParamKind.BALANCE, "DOT planck/s", 100_000_000_000, 1_000_000_000, 10_000_000_000_000, factor(2), 1, AmendmentClass.PARAM)
_row("xcm.dot_per_mb", ParamKind.BALANCE, "DOT planck/MiB", 10_000_000_000, 100_000_000, 1_000_000_000_000, factor(2), 1, AmendmentClass.PARAM)
_row("xcm.usdc_per_sec", ParamKind.BALANCE, "µUSDC/s", 50_000_000, 500_000, 5_000_000_000, factor(2), 1, AmendmentClass.PARAM)
_row("xcm.usdc_per_mb", ParamKind.BALANCE, "µUSDC/MiB", 5_000_000, 50_000, 500_000_000, factor(2), 1, AmendmentClass.PARAM)

# Hosted service registration bounds (13 §1; 16 §4, §5.2, §8.5). All six rows are
# now seeded: `svc.fee_bps` was adopted at 1,000 bps on 2026-08-02, and the last two
# `[VERIFY]` rows on 2026-08-04 — `svc.client_bond` at 100,000 VIT and
# `svc.price_cap` at 4x. Seeding `svc.client_bond` is the act that opened the
# service to clients; it was the only one of the three that gated admission,
# because `svc.max_live` already carried its provisional and an absent
# `svc.price_cap` meant `M = 1` rather than a refusal.
#
# Written through `PERBILL_PER_BPS` rather than as a literal, because 13 §1 states
# this row in **bps** while the stored kind is **Perbill** (parts per 1e9) — the two
# scales differ by 100,000×, and `orc.bond_bps` already uses this exact idiom.
# 1,000 bps = 10 % = 100,000,000 ppb. Adopted at the row maximum, so the ×2 max-Δ
# is exercisable downward only.
_row("svc.fee_bps", ParamKind.PERBILL, "ppb", 1_000 * PERBILL_PER_BPS, 0, 1_000 * PERBILL_PER_BPS, factor(2), 2, AmendmentClass.PARAM)
_row("svc.max_live", ParamKind.U32, "questions", 16, 1, 64, factor(2), 2, AmendmentClass.PARAM)
_row("svc.max_window", ParamKind.U32, "blocks", 302_400, 43_200, 302_400, factor(2), 1, AmendmentClass.PARAM)
_row("svc.epsilon_min", ParamKind.PERBILL, "ppb fraction", 10_000_000, 5_000_000, 250_000_000, factor(2), 1, AmendmentClass.PARAM)
# Adopted 2026-08-04. 100,000 VIT is exactly 4x `att.bond` above, the only other
# VIT-denominated bond and so the only in-system anchor; the value is chosen under
# R-2's escalation clause, not derived. Held for the life of the registration and
# returned on clean exit, behind a per-client ConstitutionalValues admission act.
_row("svc.client_bond", ParamKind.BALANCE, "VIT planck", 100_000 * VIT, 1_000 * VIT, 1_000_000 * VIT, factor(2), 2, AmendmentClass.PARAM)
# Adopted 2026-08-04 at 4x the §8.1 tariff, on the FIXED 1e9 grid. Paired with
# `svc.max_live` = 16 the per-admission step is (4-1)/16 = 0.1875, i.e. 3e9/16 =
# 187,500,000 grid units exactly, so full occupancy lands ON the ceiling instead of
# short of it by an integer remainder. One ceiling arms both halves of M (§8.6, §8.7).
_row("svc.price_cap", ParamKind.FIXED, "1e-9 x tariff", 4 * FIXED_SCALE, 1 * FIXED_SCALE, 64 * FIXED_SCALE, factor(2), 2, AmendmentClass.PARAM)

REGISTRY: dict[str, ParamRecord] = dict(sorted(_records.items()))
del _records


# ---------------------------------------------------------------------------
# Cross-key relations and their live binding sites (13 rule 7; SQ-547).
# The Baseline-to-dec.v_min.trs statement in rule 7 is a one-way consumer
# binding, not a relation between independently amendable values, so it has no
# breakable edge and correctly does not masquerade as a Coupling here.
# ---------------------------------------------------------------------------


class BindingSite(str, Enum):
    BOUNDARY_SCREENED = "boundary-screened"
    CONSUMING_ENGINE = "consuming-engine"
    UNSPECIFIED = "unspecified"


class ObservedConsumerCheck(str, Enum):
    """Implementation evidence kept separate from the normative binding site."""

    NOT_APPLICABLE = "not-applicable"
    CONFORMING = "conforming"
    ABSENT = "absent"
    INCONSISTENT = "inconsistent"


Predicate = Callable[[Mapping[str, int]], bool]


@dataclass(frozen=True)
class Coupling:
    name: str
    keys: tuple[str, ...]
    predicate: Predicate
    normative_binding_site: BindingSite
    observed_consumer_check: ObservedConsumerCheck
    spec_cite: str

    def holds(self, values: Mapping[str, int]) -> bool:
        return self.predicate(values)


def _sigma_delta(suffix: str) -> Predicate:
    return lambda state: 2 * state[f"dec.sigma.{suffix}"] <= state[f"dec.delta.{suffix}"]


def _gate_v_min(suffix: str) -> Predicate:
    return lambda state: (
        state[f"dec.v_min.{suffix}"] * 5
        <= state[f"gate.v_min.{suffix}"] * 100
        <= state[f"dec.v_min.{suffix}"] * 50
    )


COUPLINGS: tuple[Coupling, ...] = tuple(
    [
        Coupling(
            f"dec-sigma-{suffix}",
            (f"dec.sigma.{suffix}", f"dec.delta.{suffix}"),
            _sigma_delta(suffix),
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.ABSENT,
            "13 rule 7; 05 §5.3",
        )
        for suffix in ("param", "trs", "code", "meta")
    ]
    + [
        Coupling(
            "gate-epsilon",
            ("gate.eps", "gate.p_max"),
            lambda s: 2 * s["gate.eps"] <= s["gate.p_max"],
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.ABSENT,
            "13 rule 7; 05 §5.1",
        ),
        Coupling(
            "welfare-weights",
            ("welfare.wP", "welfare.wA"),
            lambda s: s["welfare.wP"] + s["welfare.wA"] == FIXED_SCALE,
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.CONFORMING,
            "13 rule 7; 05 §4.1/§4.4",
        ),
    ]
    + [
        Coupling(
            f"gate-v-min-{suffix}",
            (f"gate.v_min.{suffix}", f"dec.v_min.{suffix}"),
            _gate_v_min(suffix),
            BindingSite.BOUNDARY_SCREENED,
            ObservedConsumerCheck.NOT_APPLICABLE,
            "13 rule 7; 05 §5.2",
        )
        for suffix in ("param", "trs", "code", "meta")
    ]
    + [
        Coupling(
            "redemption-fee",
            ("ledger.rdm_fee", "mkt.fee"),
            lambda s: s["ledger.rdm_fee"] <= s["mkt.fee"],
            BindingSite.BOUNDARY_SCREENED,
            ObservedConsumerCheck.NOT_APPLICABLE,
            "13 rule 7; 08 §10.6",
        ),
        Coupling(
            "decision-trailing-window",
            ("dec.window", "dec.trailing"),
            lambda s: s["dec.trailing"] <= s["dec.window"],
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.INCONSISTENT,
            "05 §3.1/§5; 04 §7 (final-window containment)",
        ),
        Coupling(
            "decision-window-trade-phase",
            ("dec.window", "epoch.length"),
            lambda s: 21 * s["dec.window"] <= 13 * s["epoch.length"],
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.CONFORMING,
            "05 §3.1",
        ),
        Coupling(
            "survival-knees",
            ("welfare.thS_lo", "welfare.thS_hi"),
            lambda s: s["welfare.thS_lo"] < s["welfare.thS_hi"],
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.CONFORMING,
            "05 §4.1",
        ),
        Coupling(
            "security-knees",
            ("welfare.thC_lo", "welfare.thC_hi"),
            lambda s: s["welfare.thC_lo"] < s["welfare.thC_hi"],
            BindingSite.CONSUMING_ENGINE,
            ObservedConsumerCheck.CONFORMING,
            "05 §4.1",
        ),
        Coupling(
            "collator-min-target",
            ("collator.n_min", "collator.n_tgt"),
            lambda s: s["collator.n_min"] <= s["collator.n_tgt"],
            BindingSite.UNSPECIFIED,
            ObservedConsumerCheck.NOT_APPLICABLE,
            "05 §4.3.1; 13 §1",
        ),
    ]
)


@dataclass(frozen=True)
class Amendment:
    key: str
    before: int
    after: int
    epoch: int


@dataclass(frozen=True)
class BreakingSequence:
    coupling: str
    amendments: tuple[Amendment, ...]
    elapsed_epochs: int
    final_values: tuple[tuple[str, int], ...]

    @property
    def steps(self) -> int:
        return len(self.amendments)


@dataclass(frozen=True)
class _SearchNode:
    values: tuple[int, ...]
    elapsed_epochs: int
    changes_per_key: tuple[int, ...]
    path: tuple[Amendment, ...]


def _candidate_values(record: ParamRecord, live: int) -> tuple[int, ...]:
    """Finite, complete frontier candidates for the monotone registry relations."""
    low, high = record.admissible_interval(live)
    values = {low, high}
    if high - low <= 32:
        values.update(range(low, high + 1))
    values.discard(live)
    return tuple(sorted(values))


def genesis_values() -> dict[str, int]:
    return {key: record.value for key, record in REGISTRY.items()}


def min_breaking_sequence(coupling: Coupling, max_steps: int = 32) -> BreakingSequence | None:
    """BFS the joint I-6 amendment graph and return the shortest break.

    The graph applies record bounds/max-Δ and per-key cooldowns.  It does not
    apply ``coupling.normative_binding_site``: the point is to ask whether the
    ordinary record permits a breaking proposal and then check whether the
    designated site catches it.  Different keys may lawfully change in the same
    epoch; repeated changes to one key wait for that key's cooldown.
    """
    keys = coupling.keys
    records = tuple(REGISTRY[key] for key in keys)
    start_values = tuple(record.value for record in records)
    start_map = dict(zip(keys, start_values))
    if not coupling.holds(start_map):
        return BreakingSequence(coupling.name, (), 0, tuple(sorted(start_map.items())))

    # Every predicate in COUPLINGS is an affine half-space, strict ordering,
    # or affine equality.  If its full min/max box satisfies the predicate,
    # no interior registry value can break it and there is no graph target.
    corners = product(*((record.minimum, record.maximum) for record in records))
    if all(coupling.holds(dict(zip(keys, corner))) for corner in corners):
        return None

    frontier = [_SearchNode(start_values, 0, tuple(0 for _ in keys), ())]
    # A path with N changes to one key needs N*cooldown epochs.  Changes to a
    # different key can be armed in the same epoch, so retaining absolute
    # last-change timestamps only manufactures equivalent states.  The
    # smallest elapsed time at a value/count state is sufficient.
    seen: dict[tuple[tuple[int, ...], tuple[int, ...]], int] = {
        (start_values, tuple(0 for _ in keys)): 0
    }
    for _depth in range(1, max_steps + 1):
        next_frontier: list[_SearchNode] = []
        breaks: list[BreakingSequence] = []
        for node in sorted(
            frontier,
            key=lambda n: (n.elapsed_epochs, n.values, n.changes_per_key),
        ):
            for index, (key, record) in enumerate(zip(keys, records)):
                current = node.values[index]
                for proposed in _candidate_values(record, current):
                    changes = list(node.changes_per_key)
                    changes[index] += 1
                    epoch = max(
                        node.elapsed_epochs,
                        changes[index] * record.cooldown_epochs,
                    )
                    values = list(node.values)
                    values[index] = proposed
                    amendment = Amendment(key, current, proposed, epoch)
                    path = node.path + (amendment,)
                    mapped = dict(zip(keys, values))
                    if not coupling.holds(mapped):
                        breaks.append(
                            BreakingSequence(
                                coupling.name,
                                path,
                                epoch,
                                tuple(sorted(mapped.items())),
                            )
                        )
                        continue
                    marker = (tuple(values), tuple(changes))
                    previous = seen.get(marker)
                    if previous is not None and previous <= epoch:
                        continue
                    seen[marker] = epoch
                    next_frontier.append(
                        _SearchNode(tuple(values), epoch, tuple(changes), path)
                    )
        if breaks:
            return min(
                breaks,
                key=lambda result: (
                    result.elapsed_epochs,
                    tuple((a.key, a.after) for a in result.amendments),
                ),
            )
        frontier = next_frontier
        if not frontier:
            return None
    return None


@dataclass(frozen=True)
class CouplingFinding:
    coupling: Coupling
    breakage: BreakingSequence | None

    @property
    def breakable_in_one(self) -> bool:
        return self.breakage is not None and self.breakage.steps == 1

    @property
    def issue(self) -> str | None:
        """The implementation-conformance result, never a specification gap."""
        if self.coupling.normative_binding_site is not BindingSite.CONSUMING_ENGINE:
            return None
        observed = self.coupling.observed_consumer_check
        if observed is ObservedConsumerCheck.ABSENT:
            return "required consumer check absent"
        if observed is ObservedConsumerCheck.INCONSISTENT:
            return "consumer checks disagree with the normative predicate"
        return None

    @property
    def ok(self) -> bool:
        return self.issue is None


def coupling_findings() -> tuple[CouplingFinding, ...]:
    """All modelled relations with their implementation-conformance result."""
    return tuple(CouplingFinding(c, min_breaking_sequence(c)) for c in COUPLINGS)


def check_coupling_conformance() -> tuple[CouplingFinding, ...]:
    """SQ-547/SQ-548: required consumer checks which are absent or disagree."""
    return tuple(finding for finding in coupling_findings() if not finding.ok)


def path_to_value(key: str, target: int) -> tuple[Amendment, ...] | None:
    """Shortest monotone path for one key, with exact factor/percent rounding."""
    record = REGISTRY[key]
    if not record.minimum <= target <= record.maximum:
        return None
    current = record.value
    epoch = 0
    path: list[Amendment] = []
    while current != target:
        low, high = record.admissible_interval(current)
        proposed = min(target, high) if target > current else max(target, low)
        if proposed == current:
            return None
        epoch += record.cooldown_epochs
        path.append(Amendment(key, current, proposed, epoch))
        current = proposed
    return tuple(path)


# ---------------------------------------------------------------------------
# Governance liveness: does a reachable value disable its own repair class?
# (SQ-546).  Security-size ceilings are derived at 08 §4.1's minimum viable NAV
# with the default registry: that NAV funds exactly the default six-book POL
# slate, and sec.flow_cap bounds the greatest contest term the certificate can
# count.  The cost rounds down and the prize comparison stays multiplied.
# ---------------------------------------------------------------------------


class ProposalClass(str, Enum):
    PARAM = "PARAM"
    TREASURY = "TREASURY"
    CODE = "CODE"
    META = "META"
    CONSTITUTIONAL = "Constitutional"


MARKET_BEARING = frozenset(
    {ProposalClass.PARAM, ProposalClass.TREASURY, ProposalClass.CODE, ProposalClass.META}
)


def proposal_class_for_amendment(amendment_class: AmendmentClass) -> ProposalClass:
    if amendment_class is AmendmentClass.PARAM:
        return ProposalClass.PARAM
    if amendment_class is AmendmentClass.TREASURY:
        return ProposalClass.TREASURY
    if amendment_class in (AmendmentClass.META, AmendmentClass.META_VALUES):
        return ProposalClass.META
    return ProposalClass.CONSTITUTIONAL


_CLASS_SUFFIX = {
    ProposalClass.PARAM: "param",
    ProposalClass.TREASURY: "trs",
    ProposalClass.CODE: "code",
    ProposalClass.META: "meta",
}

# 08 §4.1 frozen class-floor literals.  The owning section explicitly says
# these do not share one re-derivation convention and must be carried exactly.
CLASS_NAV_FLOORS_USDC = {
    ProposalClass.PARAM: NAV_FLOOR_PARAM,
    ProposalClass.TREASURY: NAV_FLOOR_TREASURY,
    ProposalClass.CODE: NAV_FLOOR_CODE,
    ProposalClass.META: NAV_FLOOR_META,
}


@dataclass(frozen=True)
class AttackCostCeiling:
    proposal_class: ProposalClass
    minimum_viable_nav: Decimal
    pol_budget: Decimal
    decision_b: Decimal
    max_seedable_prize: Decimal
    contest_capital: Decimal
    attack_cost: Decimal


def attack_cost_ceiling_at_minimum_nav(
    proposal_class: ProposalClass,
) -> AttackCostCeiling:
    """Largest 05 §5.6 certificate at the class's 08 §4.1 NAV floor.

    The frozen floor funds one default decision pair and four default gate
    books under ``pol.budget_epoch``.  The largest seedable decision ``b`` is
    solved from that budget, then mapped back through 08 §5.3's Ask-scaling
    rule to the largest prize whose proposal reaches Seed.  The non-POL term
    is maximized at ``sec.flow_cap * (b_acc+b_rej)`` and F-hat is ``L/2`` for
    the default window.  This is an upper certificate, not an attack forecast.
    """
    if proposal_class not in MARKET_BEARING:
        raise ValueError("Constitutional proposals carry no security-size market")
    suffix = _CLASS_SUFFIX[proposal_class]
    b_floor = Decimal(REGISTRY[f"pol.b.{suffix}"].value) / Decimal(USDC)
    gate_b = Decimal(REGISTRY["pol.b_gate"].value) / Decimal(USDC)
    budget_rate = Decimal(REGISTRY["pol.budget_epoch"].value) / Decimal(PERBILL_SCALE)
    flow_cap = Decimal(REGISTRY["sec.flow_cap"].value) / Decimal(FIXED_SCALE)
    window = Decimal(REGISTRY["dec.window"].value)
    # 08 §4.1 frozen literals.  That section explicitly forbids a common
    # re-derivation because the four published rows use different conservative
    # rounding conventions.
    nav_floor = CLASS_NAV_FLOORS_USDC[proposal_class]
    v_min_floor = Decimal(REGISTRY[f"dec.v_min.{suffix}"].value) / Decimal(USDC)
    with localcontext() as context:
        context.prec = WORK_PREC
        budget = nav_floor * budget_rate
        max_b = round_down((budget / LN2 - Decimal(4) * gate_b) / Decimal(2))
        p_ref = (Decimal(2) * b_floor * LN2 + v_min_floor) / Decimal(2)
        max_prize = round_down(p_ref * max_b / b_floor)
        contest = flow_cap * Decimal(2) * max_b
        liquidity = l_hat(
            Decimal(2) * max_b * LN2,
            contest,
            flow_cap,
            max_b,
            max_b,
        )
        cost = attack_cost_hat(liquidity, decision_window=int(window))
    return AttackCostCeiling(
        proposal_class,
        nav_floor,
        budget,
        max_b,
        max_prize,
        contest,
        cost,
    )


ATTACK_COST_CEILINGS = {
    proposal_class: attack_cost_ceiling_at_minimum_nav(proposal_class)
    for proposal_class in sorted(MARKET_BEARING, key=lambda item: item.value)
}


def lower_slew_bound_1e9(previous: int, kappa: int, intervals: int) -> int:
    """04 §7's exact lower κ bound, rounded inward (up) on the 1e9 grid.

    The exact real envelope is ``previous * (1-kappa)^intervals``.  Applying
    one final ceiling gives the widest grid interval the document permits and
    therefore the claimant-favouring case for trying to reach zero.
    """
    if not 0 < previous <= FIXED_SCALE:
        raise ValueError("previous observation must be in (0, 1]")
    if not 0 <= kappa < FIXED_SCALE or intervals < 1:
        raise ValueError("invalid slew inputs")
    return ceil_div(
        previous * (FIXED_SCALE - kappa) ** intervals,
        FIXED_SCALE**intervals,
    )


def disables_class(
    key: str,
    value: int,
    state: Mapping[str, int] | None = None,
) -> frozenset[ProposalClass]:
    """Classes deterministically disabled by one live registry value.

    Only engine predicates which can reject *every* proposal in a class are
    represented.  A merely harder hurdle is not a disablement.  Welfare
    validation errors disable market-bearing consumers, while CONST-owned
    repair remains Constitutional and therefore outside their gate books.
    """
    values = genesis_values() if state is None else dict(state)
    values[key] = value
    if key == "gate.p_max" and value == 0:
        # 04 §7/I-13 rounds the lower slew bound inward (up).  Starting from the
        # 0.5 seed, a recorded observation therefore bottoms out at one raw
        # 1e-9 unit; 05 §5.1's strict `adopt > p_max` is always true at zero.
        return MARKET_BEARING
    if key in ("dec.window", "dec.trailing") and values["dec.trailing"] > values["dec.window"]:
        return MARKET_BEARING
    if key.startswith("sec.prize."):
        suffix = key.rsplit(".", 1)[1]
        target = {
            "param": ProposalClass.PARAM,
            "code": ProposalClass.CODE,
            "meta": ProposalClass.META,
        }[suffix]
        prize = Decimal(value) / Decimal(USDC)
        ceiling = ATTACK_COST_CEILINGS[target]
        if (
            prize > ceiling.max_seedable_prize
            or Decimal(3) * prize > ceiling.attack_cost
        ):
            return frozenset({target})
    welfare_keys = {
        "welfare.thS_lo",
        "welfare.thS_hi",
        "welfare.thC_lo",
        "welfare.thC_hi",
        "welfare.wP",
        "welfare.wA",
    }
    if key in welfare_keys:
        valid = (
            values["welfare.thS_lo"] < values["welfare.thS_hi"]
            and values["welfare.thC_lo"] < values["welfare.thC_hi"]
            and values["welfare.wP"] + values["welfare.wA"] == FIXED_SCALE
        )
        if not valid:
            return MARKET_BEARING
    return frozenset()


@dataclass(frozen=True)
class SelfSealingCorner:
    key: str
    value: int
    repair_class: ProposalClass
    disabled_classes: frozenset[ProposalClass]
    amendments: tuple[Amendment, ...]
    elapsed_epochs: int
    unsafe_direction: str

    @property
    def ok(self) -> bool:
        """Whether the class which owns repair remains available."""
        return self.repair_class not in self.disabled_classes


def self_sealing_corners(max_steps: int = 32) -> tuple[SelfSealingCorner, ...]:
    """SQ-546: mechanically find values which disable the class owning repair."""
    out: list[SelfSealingCorner] = []
    base = genesis_values()
    for key, record in REGISTRY.items():
        # Every transcribed consumer predicate is affine/equality or monotone
        # in one key.  If neither endpoint disables any class, no interior
        # value can; this mechanical pre-pass keeps u128 ranges finite without
        # a hand-written list of expected findings.
        boundary_values = {record.minimum, record.maximum, record.value}
        if not any(
            disables_class(key, value, {**base, key: value})
            for value in boundary_values
        ):
            continue
        repair = proposal_class_for_amendment(record.amendment_class)
        frontier: deque[tuple[int, tuple[Amendment, ...], int]] = deque(
            [(record.value, (), 0)]
        )
        seen = {record.value}
        found: list[SelfSealingCorner] = []
        for _depth in range(1, max_steps + 1):
            for _ in range(len(frontier)):
                current, path, epoch = frontier.popleft()
                for proposed in _candidate_values(record, current):
                    next_epoch = epoch + record.cooldown_epochs
                    amendment = Amendment(key, current, proposed, next_epoch)
                    next_path = path + (amendment,)
                    state = dict(base)
                    state[key] = proposed
                    disabled = disables_class(key, proposed, state)
                    if repair in disabled:
                        direction = "up" if proposed > record.value else "down"
                        found.append(
                            SelfSealingCorner(
                                key,
                                proposed,
                                repair,
                                disabled,
                                next_path,
                                next_epoch,
                                direction,
                            )
                        )
                        continue
                    if proposed not in seen:
                        seen.add(proposed)
                        frontier.append((proposed, next_path, next_epoch))
            if found:
                out.append(
                    min(
                        found,
                        key=lambda item: (
                            len(item.amendments),
                            item.elapsed_epochs,
                            item.value,
                        ),
                    )
                )
                break
    return tuple(sorted(out, key=lambda item: item.key))


# ---------------------------------------------------------------------------
# 07 §8 post-arm re-verification.  Local runway charges round up to µUSDC;
# remote inventory is already expressed in µUSDC.  Every proposed value below
# is the farthest value reachable in one ordinary I-6 amendment.
# ---------------------------------------------------------------------------


def reserve_probe_envelope_debit(
    fee_planck: int | None = None,
    rate_micro_usdc_per_dot: int | None = None,
) -> int:
    fee = REGISTRY["ops.probe_fee"].value if fee_planck is None else fee_planck
    rate = REGISTRY["ops.probe_rate"].value if rate_micro_usdc_per_dot is None else rate_micro_usdc_per_dot
    return ceil_div(fee * rate, DOT)


def reserve_probe_runway(
    fail_threshold: int | None = None,
    recover_threshold: int | None = None,
    fee_planck: int | None = None,
    rate_micro_usdc_per_dot: int | None = None,
) -> int:
    fail = REGISTRY["res.fail_thr"].value if fail_threshold is None else fail_threshold
    recover = REGISTRY["res.recover_thr"].value if recover_threshold is None else recover_threshold
    return (fail + recover) * reserve_probe_envelope_debit(fee_planck, rate_micro_usdc_per_dot)


@dataclass(frozen=True)
class ReverificationFinding:
    key: str
    before: int
    reachable_after_one: int
    elapsed_epochs: int
    requirement: str
    requirement_before: int
    requirement_after: int
    unit: str
    reverified_on_amendment: bool = False

    @property
    def ok(self) -> bool:
        return self.reverified_on_amendment


def post_amendment_reverification() -> tuple[ReverificationFinding, ...]:
    """Every 07 §8 first-arm resource bound whose amendment lacks a re-check."""
    baseline = reserve_probe_runway()
    rows: list[ReverificationFinding] = []
    for key in ("res.fail_thr", "res.recover_thr", "ops.probe_fee", "ops.probe_rate"):
        record = REGISTRY[key]
        _, after = record.admissible_interval(record.value)
        kwargs: dict[str, int] = {}
        if key == "res.fail_thr":
            kwargs["fail_threshold"] = after
        elif key == "res.recover_thr":
            kwargs["recover_threshold"] = after
        elif key == "ops.probe_fee":
            kwargs["fee_planck"] = after
        else:
            kwargs["rate_micro_usdc_per_dot"] = after
        rows.append(
            ReverificationFinding(
                key,
                record.value,
                after,
                record.cooldown_epochs,
                "local fail-plus-recovery runway",
                baseline,
                reserve_probe_runway(**kwargs),
                "µUSDC",
            )
        )
    amount = REGISTRY["res.probe_amount"]
    _, amount_after = amount.admissible_interval(amount.value)
    rows.append(
        ReverificationFinding(
            "res.probe_amount",
            amount.value,
            amount_after,
            amount.cooldown_epochs,
            "remote sovereign USDC inventory",
            amount.value,
            amount_after,
            "µUSDC",
        )
    )
    return tuple(sorted(rows, key=lambda item: item.key))


# ---------------------------------------------------------------------------
# 13 §2 consumed-or-projected hygiene.  This deliberately does NOT implement
# the rejected registry-endpoint collision scan: unrelated equal numbers are
# not a relation.  A symbol is live when production source consumes it or its
# metadata name is projected through #[pallet::constant_name].
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class KernelConstant:
    row: str
    symbol: str
    declaration: str
    metadata_name: str | None = None


KERNEL_CONSTANTS: tuple[KernelConstant, ...] = (
    KernelConstant("MinTrade / MaxTrade", "MIN_TRADE_USDC", "crates/futarchy-primitives/src/lib.rs", "MinTrade"),
    KernelConstant("MinTrade / MaxTrade", "MAX_TRADE_RATIO", "crates/futarchy-primitives/src/lib.rs", "MaxTradeRatio"),
    KernelConstant("dec.extension", "DEC_EXTENSION_BLOCKS", "crates/futarchy-primitives/src/lib.rs", "DecisionExtension"),
    KernelConstant("prop.max_calls / max_bytes / max_weight", "MAX_CALLS", "crates/futarchy-primitives/src/lib.rs", "MaxCalls"),
    KernelConstant("prop.max_calls / max_bytes / max_weight", "MAX_BYTES", "crates/futarchy-primitives/src/lib.rs", "MaxPayloadBytes"),
    KernelConstant("prop.max_calls / max_bytes / max_weight", "PROP_MAX_WEIGHT_NUM", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("prop.max_calls / max_bytes / max_weight", "PROP_MAX_WEIGHT_DEN", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("MAX_NESTED", "MAX_NESTED_LEVELS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("MAX_NESTED", "MAX_NESTED_CALLS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("MAX_PAYLOAD_DECODE_DEPTH", "MAX_PAYLOAD_DECODE_DEPTH", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("LMSR domain bound", "LMSR_DOMAIN_BOUND", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("LMSR domain bound", "QUOTE_CLAMP_MIN_1E9", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("LMSR domain bound", "QUOTE_CLAMP_MAX_1E9", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("LMSR error bounds", "PRIMITIVE_MAX_ULP", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("LMSR error bounds", "COMPOSED_COST_MAX_ULP", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("VOID payout rules", "VOID_BASELINE_SCORE", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("DescriptorLeadTime", "DESCRIPTOR_LEAD_TIME_BLOCKS", "crates/futarchy-primitives/src/lib.rs", "DescriptorLeadTime"),
    KernelConstant("MIGRATION_STALL_BLOCKS", "MIGRATION_STALL_BLOCKS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("PB-LEDGER-FREEZE", "PLAYBOOK_FREEZE_WINDOW_BLOCKS", "crates/futarchy-primitives/src/lib.rs", "PlaybookFreezeWindowBlocks"),
    KernelConstant("Expedited CODE lane", "DESCRIPTOR_LEAD_TIME_BLOCKS", "crates/futarchy-primitives/src/lib.rs", "DescriptorLeadTime"),
    KernelConstant("Watchtower window extension", "WATCHTOWER_EXTENSION_BLOCKS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("OracleSettleDeadline", "HOUSEKEEPING_NUM", "crates/futarchy-primitives/src/lib.rs", "PhaseOffsets"),
    KernelConstant("orc.max_proof_bytes", "ORC_MAX_PROOF_BYTES", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("registry / watchtower / attestor bounds", "REG_MAX_FILINGS_EPOCH", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("registry / watchtower / attestor bounds", "WT_MAX", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("registry / watchtower / attestor bounds", "ATT_MIN_MEMBERS", "crates/futarchy-primitives/src/lib.rs", "AttMinMembers"),
    KernelConstant("registry / watchtower / attestor bounds", "ATT_QUORUM", "crates/futarchy-primitives/src/lib.rs", "AttQuorum"),
    KernelConstant("Kernel attestation", "ATT_MIN_MEMBERS", "crates/futarchy-primitives/src/lib.rs", "AttMinMembers"),
    KernelConstant("Kernel attestation", "ATT_QUORUM", "crates/futarchy-primitives/src/lib.rs", "AttQuorum"),
    KernelConstant("Dead-man switch", "DEAD_MAN_RELAY_BLOCKS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Dead-man switch", "DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("StaleEpochBound", "STALE_EPOCH_BOUND_BLOCKS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Crank batch bounds", "TICK_BATCH", "crates/futarchy-primitives/src/lib.rs", "TickBatch"),
    KernelConstant("Crank batch bounds", "REAP_BATCH", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Crank batch bounds", "SETTLE_COHORT_MAX_ITEMS", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Crank batch bounds", "ORACLE_DEADLINE_CATCHUP", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Crank batch bounds", "COMPONENT_VALUE_REAP_BATCH", "crates/oracle-core/src/lib.rs"),
    KernelConstant("Crank batch bounds", "GUARDIAN_MAINTENANCE_BATCH", "pallets/guardian/src/lib.rs"),
    KernelConstant("Entrenched floors", "THETA_S_LO", "crates/welfare-core/src/lib.rs"),
    KernelConstant("Entrenched floors", "THETA_C_LO", "crates/welfare-core/src/lib.rs"),
    KernelConstant("Keeper-budget floor note", "KEEPER_BUDGET_EPOCH_FLOOR_USDC", "crates/futarchy-primitives/src/lib.rs"),
    KernelConstant("Position-deposit freeze note", "POSITION_DEPOSIT_USDC", "crates/futarchy-primitives/src/lib.rs"),
)


@dataclass(frozen=True)
class KernelHygieneFinding:
    constant: KernelConstant
    declared: bool
    consumed: bool
    projected: bool

    @property
    def ok(self) -> bool:
        return self.declared and (self.consumed or self.projected)


def _production_rust_files(root: Path) -> Iterable[Path]:
    excluded_dirs = {"target", "tests", "benches", "worktrees", ".git"}
    excluded_files = {"tests.rs", "mock.rs", "benchmarking.rs"}
    # Prune before descent: filtering rglob's results is too late for target/
    # and nested worktrees, whose transient build files may disappear mid-scan.
    for current, dirs, files in os.walk(root, topdown=True):
        dirs[:] = sorted(name for name in dirs if name not in excluded_dirs)
        directory = Path(current)
        for name in sorted(files):
            if name.endswith(".rs") and name not in excluded_files:
                yield directory / name


def _rust_code(source: str) -> str:
    """Remove comments so prose mentions cannot masquerade as consumers."""
    without_blocks = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", without_blocks)


def kernel_hygiene(root: str | Path) -> tuple[KernelHygieneFinding, ...]:
    """Resolve every modelled 13 §2 symbol against production Rust source."""
    repo = Path(root).resolve()
    texts: dict[str, str] = {}
    for path in _production_rust_files(repo):
        texts[path.relative_to(repo).as_posix()] = _rust_code(
            path.read_text(encoding="utf-8")
        )
    out: list[KernelHygieneFinding] = []
    for constant in KERNEL_CONSTANTS:
        pattern = re.compile(rf"\b{re.escape(constant.symbol)}\b")
        declaration_pattern = re.compile(
            rf"\b(?:pub\s+)?const\s+{re.escape(constant.symbol)}\b"
        )
        declaration_source = texts.get(constant.declaration, "")
        declarations = len(declaration_pattern.findall(declaration_source))
        occurrences = 0
        for relative, source in texts.items():
            count = len(pattern.findall(source))
            if relative == constant.declaration:
                # cfg alternatives can declare one symbol more than once.  No
                # declaration is a consumer; same-module uses still are.
                count -= declarations
            occurrences += max(0, count)
        projected = False
        if constant.metadata_name is not None:
            projection = re.compile(
                rf"#\[pallet::constant_name\({re.escape(constant.metadata_name)}\)\]"
            )
            projected = any(projection.search(source) for source in texts.values())
        out.append(
            KernelHygieneFinding(
                constant,
                declarations > 0,
                occurrences > 0,
                projected,
            )
        )
    return tuple(out)


def kernel_orphans(root: str | Path) -> tuple[KernelHygieneFinding, ...]:
    return tuple(finding for finding in kernel_hygiene(root) if not finding.ok)
