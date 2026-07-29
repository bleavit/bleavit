#!/usr/bin/env python3
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import multiprocessing
import os
import random
import sys
from decimal import Decimal, getcontext
from pathlib import Path
from typing import NamedTuple

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "reference-model" / "src")
)

from bleavit_reference_model.decision import Grade, decide
from bleavit_reference_model.ledger import (
    DEFAULT_REDEEM_FEE_PERBILL,
    MIN_SPLIT,
    PERBILL_ONE,
    BaselineState,
    BaselineVault,
    Branch,
    GateSide,
    GateType,
    PositionKind,
    ScalarSide,
    Vault,
    VaultState,
)
from bleavit_reference_model.lmsr import (
    WORK_PREC,
    cost,
    fmt,
    marginal_price_long,
    raw_64x64_nearest,
    ref_exp2,
    ref_ln,
    ref_log2,
    vectors_v1_v6,
    worked_maker_example,
)
from bleavit_reference_model.treasury import (
    attack_cost_hat,
    baseline_commitment,
    dec_v_min,
    decision_pair_contest_capital,
    decision_delta,
    display_integer,
    in_cap_prize,
    l_hat,
    nav_floor,
    p_ref,
    pol_b,
    pol_commitment,
    security_sizing_ok,
)
from bleavit_reference_model.twap import (
    STALE_GAP_BLOCKS,
    ContestCapitalAccumulator,
    TwapAccumulator,
)
from bleavit_reference_model.welfare import (
    apply_normalization,
    floor_fixed,
    full_pipeline,
    full_pipeline_renormalized,
    is_log1p_series,
    normalization_constants,
    normalization_sample,
    settlement_score,
)

SWEEP_SCHEMA = "bleavit.reference-model.v3"
SWEEP_MASTER_SEED = 0xB1EA_5EED_256B_0001
SWEEP_SEED_STEP = 0x9E37_79B9_7F4A_7C15
SWEEP_STRUCTURED_ROWS = 20

DECISION_SCENARIOS = [
    {
        "name": "honest_param_adopt",
        "inputs": {
            "proposal_class": "Param",
            "accept_full": "0.517",
            "accept_trailing": "0.517",
            "delta": "0.015",
            "envelope_value": "100",
            "measured_liquidity": "1000000",
        },
    },
    {
        "name": "constitution_violation",
        "inputs": {"preimage_ok": False},
    },
    {
        "name": "resource_conflict",
        "inputs": {"resource_locks_held": False},
    },
    {"name": "process_hold", "inputs": {"process_hold": True}},
    {
        "name": "gate_book_invalid",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "100",
            "spendable_nav": "7393600",
            "gate_book_valid": False,
        },
    },
    {
        "name": "param_gate_veto_survival",
        "inputs": {
            "proposal_class": "Param",
            "envelope_value": "100",
            "measured_liquidity": "1000000",
            "p_adopt": {"Survival": "0.06"},
            "p_reject": {"Survival": "0.01"},
        },
    },
    {
        "name": "param_gate_veto_security",
        "inputs": {
            "proposal_class": "Param",
            "envelope_value": "100",
            "measured_liquidity": "1000000",
            "p_adopt": {"Survival": "0.01", "Security": "0.06"},
            "p_reject": {"Survival": "0.01", "Security": "0.01"},
        },
    },
    {
        "name": "gate_veto_precedes_welfare_invalid",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "100",
            "spendable_nav": "7393600",
            "p_adopt": {"Survival": "0.06"},
            "welfare_grade": "Invalid",
        },
    },
    {
        "name": "gate_veto_precedes_later_gate_invalid",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "100",
            "spendable_nav": "7393600",
            "gate_valid": {"Survival": True, "Security": False},
            "p_adopt": {"Survival": "0.06"},
            "p_reject": {"Survival": "0.01"},
        },
    },
    {
        "name": "welfare_invalid",
        "inputs": {"welfare_grade": "Invalid"},
    },
    {
        "name": "welfare_insufficient_extends",
        "inputs": {"welfare_grade": "Insufficient"},
    },
    {
        "name": "hurdle_not_met",
        "inputs": {"accept_full": "0.54"},
    },
    {
        "name": "convergence_failed",
        "inputs": {"converged": False},
    },
    {
        "name": "second_extension_failed",
        "inputs": {
            "accept_trailing": "0.52",
            "extended": True,
        },
    },
    {
        "name": "security_sizing",
        "inputs": {
            "envelope_value": "1",
            "measured_liquidity": "0",
        },
    },
    {
        "name": "undefined_param_prize_proxy",
        "inputs": {"measured_liquidity": "1000000"},
    },
    {
        "name": "attestation_missing",
        "inputs": {
            "proposal_class": "Code",
            "envelope_value": "0",
            "attestation_ok": False,
        },
    },
    {
        "name": "rate_limited",
        "inputs": {"envelope_value": "0", "queue_time_ok": False},
    },
    # SQ-231: step 9's L-hat from the decomposed 08 §5.2 form — POL depth plus
    # min(the two books' 04 §7a contest capital), bounded by
    # sec.flow_cap·(b_acc+b_rej). The equal-book row reproduces the 08 §5.4(b)
    # treasury example (3P = 600,000).
    {
        "name": "adopt_contest_capital_l_hat",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "200000",
            "pol_depth": "34657.359028",
            "contest_accept": "400000",
            "contest_reject": "400000",
            "flow_cap": "8",
            "b_accept": "25000",
            "b_reject": "25000",
        },
    },
    {
        "name": "security_sizing_contest_shortfall",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "200000",
            "pol_depth": "34657.359028",
            "contest_accept": "100000",
            "contest_reject": "100000",
            "flow_cap": "8",
            "b_accept": "25000",
            "b_reject": "25000",
        },
    },
    {
        "name": "security_sizing_flow_cap_ceiling",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "200000",
            "pol_depth": "34657.359028",
            "contest_accept": "1000000000",
            "contest_reject": "1000000000",
            "flow_cap": "7",
            "b_accept": "25000",
            "b_reject": "25000",
        },
    },
    {
        "name": "security_sizing_asymmetric_pair_contest",
        "inputs": {
            "proposal_class": "Treasury",
            "ask": "200000",
            "pol_depth": "34657.359028",
            "contest_accept": "400000",
            "contest_reject": "100000",
            "flow_cap": "8",
            "b_accept": "25000",
            "b_reject": "25000",
        },
    },
]

WELFARE_INPUTS = {
    "u": "0.97",
    "f": "0.96",
    "hhi": "0.335",
    "phase": 2,
    "c_onchain": {"C01": "0.94", "C02": "0.91"},
    "c_attested": {"C03": "0.90"},
    "c_weights": {"C01": "0.50", "C02": "0.30", "C03": "0.20"},
    "incident": "0.98",
    "p_components": {"P01": "0.80", "P02": "0.70"},
    "p_weights": {"P01": "0.60", "P02": "0.40"},
    "a_components": {"A01": "0.90", "A02": "0.60"},
    "a_weights": {"A01": "0.40", "A02": "0.60"},
    "c_daily": {"C01": "0.93", "C02": "0.89"},
}

WELFARE_NON_BINARY_DAILY_WEIGHTS_INPUTS = {
    **WELFARE_INPUTS,
    "c_weights": {"C01": "0.10", "C02": "0.50", "C03": "0.40"},
    "c_daily": {"C01": "0.531441", "C02": "1.0"},
}

# Same components at live gates: S = min(0.99, 0.99, D_eff=1) = 0.99 ≥ θS⁺, so
# g(S) = 1 and `W` is not gate-vetoed to zero. `WELFARE_INPUTS` sits at
# S = 0.83125 < θS⁻ = 0.90 (05 §4.1), which zeroes `W` and makes every row over
# it a pillar-only vector; the 07 §10 recompute's composite leg — an emptied
# pillar renormalizing `{wP, wA}` — is only observable in `W` with the gates open.
WELFARE_LIVE_GATES_INPUTS = {
    **WELFARE_INPUTS,
    "u": "0.99",
    "f": "0.99",
    "hhi": "0.10",
}


# 05 §4.6 normalization scenarios (SQ-502). Every row carries the whole input
# state a replay needs — the 12 genesis pseudo-observations, the finalized epoch
# values available, the raw value, and whether §4.3 declares the series
# heavy-tailed — plus the assembled sample, the frozen constants and the
# normalized output. `metric_id` binds a row to the canonical v1 component
# (05 §4.3), so a conforming implementation can replay it through the registered
# `MetricSpec` rather than through a loose helper: that is the read which makes
# `MetricSpec.prior_bounds` load-bearing.
NORMALIZATION_SCENARIOS = [
    {
        # Epoch 1: `n = min(e − 1, 12) = 0`, so the sample is the genesis prior
        # untouched and `s` is deterministically computable from epoch 1 (D-15).
        "name": "cold_start_epoch_1_pure_priors",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": [],
        "value": "21.0",
    },
    {
        # Epoch 7: six finalized epochs have displaced the six *oldest*
        # pseudo-observations; six priors still carry the tail of the window.
        "name": "cold_start_epoch_7_displaces_six_priors",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": ["40.0", "38.5", "44.25", "36.75", "41.125", "39.0"],
        "value": "21.0",
    },
    {
        # Epoch 13: the sample is fully real and the cold-start rule reduces to
        # the steady-state rule with no discontinuity in mechanism (05 §4.6).
        "name": "steady_state_epoch_13_priors_fully_displaced",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": [
            "40.0", "38.5", "44.25", "36.75", "41.125", "39.0",
            "43.5", "37.25", "45.0", "42.625", "35.5", "46.75",
        ],
        "value": "41.0",
    },
    {
        # Past the window the oldest *real* values fall out too: the sample is
        # the trailing 12 of a 15-element finalized history, priors absent.
        "name": "window_slides_past_the_priors",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": [
            "40.0", "38.5", "44.25", "36.75", "41.125", "39.0",
            "43.5", "37.25", "45.0", "42.625", "35.5", "46.75",
            "50.0", "48.125", "52.5",
        ],
        "value": "44.0",
    },
    {
        # A raw value above p95 is clipped to the ceiling and maps to exactly 1;
        # winsorization is what keeps a single outlier epoch from rescaling the
        # whole series.
        "name": "winsorized_above_p95_pins_the_ceiling",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": [],
        "value": "9999.0",
    },
    {
        "name": "winsorized_below_p5_pins_the_floor",
        "metric_id": 22,
        "prior_bounds": [
            "12.5", "18.25", "9.75", "31.5", "22.125", "15.0",
            "27.375", "11.625", "24.0", "19.5", "33.25", "16.875",
        ],
        "finalized": [],
        "value": "0.0",
    },
    {
        # The heavy-tailed `P` fees series, `N(log1p(fees_USDC))` (05 §4.3,
        # MetricId 20): three orders of magnitude inside one 12-epoch window.
        "name": "heavy_tail_fees_log1p",
        "metric_id": 20,
        "prior_bounds": [
            "1200.5", "980.25", "1450.75", "1100.0", "15000.5", "1320.125",
            "1050.375", "1600.0", "890.625", "1250.25", "142000.75", "1180.5",
        ],
        "finalized": [],
        "value": "3200.0",
    },
    {
        # The identical sample and value under the linear map. The pair is a
        # controlled A/B: the only difference is §4.3's `log1p`, so the two rows
        # isolate exactly what the transform does to a heavy tail.
        "name": "heavy_tail_fees_linear_control",
        "metric_id": 22,
        "prior_bounds": [
            "1200.5", "980.25", "1450.75", "1100.0", "15000.5", "1320.125",
            "1050.375", "1600.0", "890.625", "1250.25", "142000.75", "1180.5",
        ],
        "finalized": [],
        "value": "3200.0",
    },
    {
        # 05 §4.6 rule 3: an unmoved series has no map onto [0,1] and the
        # computation refuses. It MUST NOT resolve to the adopt-favourable 1.0.
        "name": "degenerate_constant_sample_fails_closed",
        "metric_id": 22,
        "prior_bounds": ["7.5"] * 12,
        "finalized": [],
        "value": "7.5",
    },
    {
        # The same refusal reached through the transform rather than the raw
        # series: p5 and p95 differ by three 1e-9 units, which `log1p` at this
        # magnitude compresses onto a single grid point. The linear control row
        # below normalizes the identical sample successfully, so this is the
        # transform collapsing the range, not the sample being constant.
        "name": "degenerate_after_log1p_fails_closed",
        "metric_id": 20,
        "prior_bounds": [
            "5.000000000", "5.000000000", "5.000000001", "5.000000001",
            "5.000000002", "5.000000002", "5.000000002", "5.000000002",
            "5.000000002", "5.000000002", "5.000000003", "5.000000003",
        ],
        "finalized": [],
        "value": "5.000000002",
    },
    {
        "name": "degenerate_after_log1p_linear_control",
        "metric_id": 22,
        "prior_bounds": [
            "5.000000000", "5.000000000", "5.000000001", "5.000000001",
            "5.000000002", "5.000000002", "5.000000002", "5.000000002",
            "5.000000002", "5.000000002", "5.000000003", "5.000000003",
        ],
        "finalized": [],
        "value": "5.000000002",
    },
]


def _normalization_row(scenario):
    """One 05 §4.6 row: assemble, freeze, normalize — or record the refusal."""
    prior = [Decimal(value) for value in scenario["prior_bounds"]]
    finalized = [Decimal(value) for value in scenario["finalized"]]
    value = Decimal(scenario["value"])
    log1p_series = is_log1p_series(scenario["metric_id"])
    sample = normalization_sample(prior, finalized)
    row = {
        "name": scenario["name"],
        "inputs": {
            "metric_id": scenario["metric_id"],
            "log1p": log1p_series,
            "prior_bounds": [format(item, "f") for item in prior],
            "finalized": [format(item, "f") for item in finalized],
            "value": format(floor_fixed(value), "f"),
        },
        "sample": [format(item, "f") for item in sample],
    }
    try:
        constants = normalization_constants(sample, log1p_series)
    except ValueError:
        # 05 §4.6 rule 3 — the fail-closed outcome is part of the corpus, not an
        # absence from it. A conforming implementation must refuse this row.
        row["error"] = "DegenerateNormalizationRange"
        return row
    row["constants"] = {
        "p_low": format(constants["p_low"], "f"),
        "p_high": format(constants["p_high"], "f"),
        "lo": format(constants["lo"], "f"),
        "hi": format(constants["hi"], "f"),
    }
    row["normalized"] = format(apply_normalization(constants, value), "f")
    return row


def _decimal_tree(value):
    if isinstance(value, dict):
        return {key: _decimal_tree(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decimal_tree(item) for item in value]
    if isinstance(value, str):
        try:
            return Decimal(value)
        except Exception:
            return value
    return value


def _string_tree(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: _string_tree(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_string_tree(item) for item in value]
    return value


def _decision_row(scenario):
    inputs = {
        "accept_full": Decimal("0.56"),
        "reject_full_effective": Decimal("0.50"),
        "delta": Decimal("0.05"),
    }
    supplied = _decimal_tree(scenario["inputs"])
    if "welfare_grade" in supplied:
        supplied["welfare_grade"] = Grade(supplied["welfare_grade"])
    inputs.update(supplied)
    decision = decide(**inputs)
    # 04 §5: every row carries the full effective input set (base + overrides), not
    # just the scenario override, so `decide(**row["inputs"])` replays it standalone.
    replay = dict(inputs)
    if isinstance(replay.get("welfare_grade"), Grade):
        replay["welfare_grade"] = replay["welfare_grade"].value
    row = {"name": scenario["name"], "inputs": _string_tree(replay)}
    if "contest_accept" in inputs:
        pair_contest = decision_pair_contest_capital(
            inputs["contest_accept"], inputs["contest_reject"]
        )
        row["l_hat"] = format(
            l_hat(
                inputs["pol_depth"],
                pair_contest,
                inputs["flow_cap"],
                inputs["b_accept"],
                inputs["b_reject"],
            ),
            "f",
        )
    row["outcome"] = decision.outcome.value
    if decision.reason is not None:
        row["reason"] = decision.reason.value
    return row


def _ledger_scenarios():
    voided = Vault()
    voided.split(10_000_003)
    voided.split_scalar(Branch.ACCEPT, 4_000_003)
    voided.void()
    void_branch = voided.redeem_void(
        Branch.REJECT, PositionKind.BRANCH_USDC, 10_000_003
    )
    void_leg = voided.redeem_void(
        Branch.ACCEPT, PositionKind.LONG, 4_000_003
    )

    b5 = Vault()
    b5.split(20_000)
    b5.split_scalar(Branch.ACCEPT, 20_000)
    b5.resolve(Branch.ACCEPT)
    b5.settle_scalar(Decimal("0.70005"))
    long_payout = b5.redeem_scalar(
        Branch.ACCEPT, ScalarSide.LONG, 20_000
    )
    short_payouts = [
        b5.redeem_scalar(Branch.ACCEPT, ScalarSide.SHORT, 10_000),
        b5.redeem_scalar(Branch.ACCEPT, ScalarSide.SHORT, 10_000),
    ]

    pair = Vault()
    pair.split(20_000)
    pair.split_scalar(Branch.ACCEPT, 20_000)
    pair.resolve(Branch.ACCEPT)
    pair.settle_scalar(Decimal("0.70005"))
    pair_payout = pair.redeem_scalar_pair(Branch.ACCEPT, 20_000)

    gate = Vault()
    gate.split(1_000)
    gate.split_gate(Branch.ACCEPT, GateType.SURVIVAL, 1_000)
    gate.resolve(Branch.ACCEPT)
    gate.settle_gate(GateType.SURVIVAL, True)
    gate.settle_scalar(Decimal("0.5"))
    yes_payout = gate.redeem_gate(
        Branch.ACCEPT, GateType.SURVIVAL, GateSide.YES, 300
    )
    no_payout = gate.redeem_gate(
        Branch.ACCEPT, GateType.SURVIVAL, GateSide.NO, 300
    )

    baseline = BaselineVault(epoch=7)
    baseline.split_baseline(20_000)
    baseline.settle_baseline(Decimal("0.70005"))
    baseline_long = baseline.redeem_baseline(ScalarSide.LONG, 10_000)
    baseline_pair = baseline.redeem_baseline_pair(10_000)

    for vault in (voided, b5, pair, gate):
        vault.check_conservation()
    baseline.check_conservation()
    return [
        {
            "name": "void_branch_and_leg_floors",
            "unit": "USDC base units (1e-6)",
            "inputs": {
                "branch_amount": 10_000_003,
                "scalar_leg_amount": 4_000_003,
            },
            "branch_payout": void_branch,
            "leg_payout": void_leg,
        },
        {
            "name": "b5_scalar_fragmentation",
            "unit": "USDC base units (1e-6)",
            "inputs": {"s": "0.70005", "escrow": 20_000},
            "long_payout": long_payout,
            "short_payouts": short_payouts,
            "total_payout": long_payout + sum(short_payouts),
        },
        {
            "name": "scalar_pair_exact",
            "unit": "USDC base units (1e-6)",
            "inputs": {"s": "0.70005", "amount": 20_000},
            "payout": pair_payout,
        },
        {
            "name": "gate_settlement_one_zero",
            "unit": "USDC base units (1e-6)",
            "inputs": {
                "gate": "Survival",
                "outcome": True,
                "amount_each": 300,
            },
            "yes_payout": yes_payout,
            "no_payout": no_payout,
        },
        {
            "name": "baseline_scalar_and_pair",
            "unit": "USDC base units (1e-6)",
            "inputs": {"epoch": 7, "s": "0.70005", "amount": 10_000},
            "long_payout": baseline_long,
            "pair_payout": baseline_pair,
        },
    ]


# 15 §4.4 / 03 §11: the sequence corpus is generated by this single
# reference-model generator.  The account layer below is deliberately kept out
# of ledger.py: that module is the aggregate accounting model, while this
# harness adds the per-holder ownership needed to drive transfer/redemption
# programs against the Rust core.
_LEDGER_SEQUENCE_SEED = 0x5EED_1ED6_EA5E_0001
_MIN_LEDGER_AMOUNT = 10_000
_SEQUENCE_ACCOUNTS = ("alice", "bob", "carol")
_SEQUENCE_INTENTS = (
    "void-after-open",
    "void-after-resolved",
    "gate-settle-then-pair-redemption",
    "gate-false-and-unpaired-rounding",
    "baseline-pair-redemption",
    "baseline-unpaired-rounding",
    "terminal-residue-for-pallet-split",
    "illegal-terminal-interleavings",
)
_ROUNDING_SCORES = (
    0,
    1,
    123_456_789,
    333_333_333,
    500_000_001,
    700_049_999,
    700_050_000,
    700_050_001,
    999_999_999,
    1_000_000_000,
)
_POSITION_DEPOSIT = 100_000


class _SequenceError(Exception):
    def __init__(self, error_class):
        super().__init__(error_class)
        self.error_class = error_class


# 02 §6 "Redemption-fee field append" (contract v17): exactly these four
# ledger events gain a **trailing** `fee: Balance`. `Redeemed` and
# `VoidRedeemed` do NOT gain it and MUST NOT — a `fee` field on either would
# be identically zero forever while implying a charge the ledger is forbidden
# to make (rule 3). The set is written out here, not derived, because it is
# frozen contract surface.
_FEE_BEARING_EVENTS = frozenset(
    {
        "ScalarRedeemed",
        "ScalarPairRedeemed",
        "GateRedeemed",
        "BaselineRedeemed",
    }
)

_CONTRACT_V16 = 16
_CONTRACT_V17 = 17


class _Payout(NamedTuple):
    """One redemption's three distinct quantities, never interchangeable.

    02 §6 rule 1: the event's pre-existing `amount`/`payout` field carries the
    **gross** — the claim value burned, the quantity 03 §5.3 decrements
    `escrowed` by — and `fee` is the trailing append, so a consumer computes
    `net = payout − fee`. The **net** is the dispatch return, never an event
    field. Naming all three at the point they are derived is what stops a net
    value reaching a gross field.
    """

    gross: int
    fee: int
    net: int


def _proposal_key(branch, kind, gate=None):
    key = f"proposal/{branch.value}/{kind.value}"
    return f"{key}/{gate.value}" if gate is not None else key


def _baseline_key(side):
    return f"baseline/{side.value}"


def _position_key(position):
    if position["family"] == "baseline":
        return _baseline_key(ScalarSide(position["side"]))
    gate = position.get("gate")
    return _proposal_key(
        Branch(position["branch"]),
        PositionKind(position["kind"]),
        GateType(gate) if gate is not None else None,
    )


class _LedgerSequenceModel:
    """Transactional per-account driver for the 03 §11 operation alphabet."""

    def __init__(
        self,
        redeem_fee: int = 0,
        min_split: int = MIN_SPLIT,
        protocol_accounts=(),
        contract_version: int = _CONTRACT_V16,
    ):
        # 02 §13/§14: the redemption-fee field append is contract **v17**, and
        # that entry is explicit that the bump is atomic with the surface —
        # `INTEGRATION_CONTRACT_VERSION` stays 16 until E1 ships. So the model
        # emits the shape of the version it is configured for: the pre-E1
        # sequence corpus stays v16 (the in-force surface), and the E1 fee
        # corpus is v17 (the target it exists to pin). A v16 model that
        # somehow charged a fee would be emitting an event that cannot carry
        # it, so that combination is refused outright below.
        self.contract_version = contract_version
        # 03 §5.3a: the rate defaults to 0, so the 64 pre-E1 sequence rows are
        # generated at exactly their historical behaviour and the fee corpus
        # opts in explicitly.
        self.redeem_fee = redeem_fee
        self.min_split = min_split
        self.protocol_accounts = tuple(protocol_accounts)
        self.proposal = Vault(redeem_fee=redeem_fee, min_split=min_split)
        self.baseline = BaselineVault(
            epoch=7, redeem_fee=redeem_fee, min_split=min_split
        )
        self.balances = {account: {} for account in _SEQUENCE_ACCOUNTS}
        self.events = []
        self.count_accounts = []

    def apply(self, operation):
        # 03 §5: calls are atomic.  Execute on a clone and publish the clone
        # only after the complete operation succeeds.
        trial = copy.deepcopy(self)
        try:
            result = trial._apply(operation["op"], operation.get("args", {}))
        except _SequenceError as error:
            return {"err": error.error_class}
        except ValueError as error:
            raise AssertionError(
                f"unclassified Python ledger error for {operation}: {error}"
            ) from error
        self.proposal = trial.proposal
        self.baseline = trial.baseline
        self.balances = trial.balances
        self.events = trial.events
        self.count_accounts = trial.count_accounts
        return {"ok": result}

    @staticmethod
    def _amount(args):
        amount = args["amount"]
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
            raise AssertionError(f"generator emitted invalid amount {amount!r}")
        return amount

    def _balance(self, account, key):
        return self.balances[account].get(key, 0)

    def _is_protocol(self, account):
        """03 §5.3a(1): `ProtocolAccounts` are exempt from the redemption fee."""
        return account in self.protocol_accounts

    def fees_accrued(self):
        """The §5.3a(4) counter, summed over both vaults."""
        return (
            self.proposal.redemption_fees_accrued
            + self.baseline.redemption_fees_accrued
        )

    def fees_charged_total(self):
        return (
            self.proposal.fees_charged_total
            + self.baseline.fees_charged_total
        )

    def fees_swept_total(self):
        return (
            self.proposal.fees_swept_total + self.baseline.fees_swept_total
        )

    def _ensure_holds(self, account, key, amount):
        if self._balance(account, key) < amount:
            raise _SequenceError("InsufficientPosition")

    def _burn(self, account, key, amount):
        self._ensure_holds(account, key, amount)
        if amount == 0:
            return
        remaining = self._balance(account, key) - amount
        if remaining:
            self.balances[account][key] = remaining
        else:
            self.balances[account].pop(key, None)

    def _mint(self, account, key, amount):
        if amount:
            if account not in self.count_accounts:
                self.count_accounts.append(account)
            self.balances[account][key] = self._balance(account, key) + amount

    def _emit(self, kind, *fields):
        self.events.append({"kind": kind, "fields": list(fields)})

    def _measure(self, vault, call):
        """Run one redemption and name its three quantities separately.

        The vault call returns the **net** (what the dispatch hands back); the
        **gross** is read from the escrow outflow and the **fee** from the
        accrual counter, so each is derived from the quantity it actually is.
        """
        before_gross = vault.total_payouts
        before_fee = vault.fees_charged_total
        net = call()
        gross = vault.total_payouts - before_gross
        fee = vault.fees_charged_total - before_fee
        if net + fee != gross:
            raise AssertionError("net + fee != gross")
        return _Payout(gross=gross, fee=fee, net=net)

    def _emit_redemption(self, kind, leading, payout):
        """02 §6 emit seam for the redemption events.

        `payout` is a `_Payout`, so the gross cannot be confused with the net:
        the pre-existing `amount`/`payout` field is filled from `.gross`
        (rule 1) and `.net` is never emitted at all. The trailing `fee` is
        appended only for the four fee-bearing events of the append block, and
        only at contract v17; `Redeemed` and `VoidRedeemed` can never receive
        one (rule 3), which is enforced here rather than left to each site.
        """
        if kind in _FEE_BEARING_EVENTS:
            if self.contract_version >= _CONTRACT_V17:
                self._emit(kind, *leading, payout.gross, payout.fee)
                return
            if payout.fee:
                raise AssertionError(
                    f"{kind} charged a fee at contract v"
                    f"{self.contract_version}, which has no field to carry it"
                )
        elif payout.fee:
            raise AssertionError(f"{kind} is fee-exempt but charged a fee")
        self._emit(kind, *leading, payout.gross)

    def _redemption_outcome(self, kind, burned, payout):
        """The per-op result, in the same gross+fee language as the event."""
        result = {"burned": burned, "payout": payout.gross}
        if kind in _FEE_BEARING_EVENTS and (
            self.contract_version >= _CONTRACT_V17
        ):
            result["fee"] = payout.fee
        return result

    def _proposal_state(self, *states):
        if self.proposal.state not in states:
            raise _SequenceError("WrongVaultState")

    def _baseline_state(self, *states):
        if self.baseline.state not in states:
            raise _SequenceError("WrongVaultState")

    @staticmethod
    def _score(raw):
        # Rust validates FixedU64 against the 1e9 score scale before checking
        # the state, so the reference driver uses the same error precedence.
        if not isinstance(raw, int) or raw < 0 or raw > 1_000_000_000:
            raise _SequenceError("InvalidScore")
        return Decimal(raw) / Decimal(1_000_000_000)

    def _apply(self, name, args):
        account = args.get("account", "alice")
        amount = self._amount(args) if "amount" in args else None

        if name == "split":
            if amount < _MIN_LEDGER_AMOUNT:
                raise _SequenceError("AmountTooSmall")
            self._proposal_state(VaultState.OPEN)
            self.proposal.split(amount)
            for branch in Branch:
                self._mint(
                    account,
                    _proposal_key(branch, PositionKind.BRANCH_USDC),
                    amount,
                )
            self._emit("Split", 1, amount)
            return {"minted": amount}

        if name == "merge":
            self._proposal_state(
                VaultState.OPEN, VaultState.RESOLVED, VaultState.VOIDED
            )
            keys = [
                _proposal_key(branch, PositionKind.BRANCH_USDC)
                for branch in Branch
            ]
            for key in keys:
                self._ensure_holds(account, key, amount)
            payout = self.proposal.merge(amount)
            for key in keys:
                self._burn(account, key, amount)
            self._emit("Merged", 1, amount)
            return {"burned": amount, "payout": payout}

        if name in ("split_scalar", "merge_scalar"):
            branch = Branch(args["branch"])
            branch_key = _proposal_key(branch, PositionKind.BRANCH_USDC)
            long_key = _proposal_key(branch, PositionKind.LONG)
            short_key = _proposal_key(branch, PositionKind.SHORT)
            if name == "split_scalar":
                self._proposal_state(VaultState.OPEN)
                self._ensure_holds(account, branch_key, amount)
                self.proposal.split_scalar(branch, amount)
                self._burn(account, branch_key, amount)
                self._mint(account, long_key, amount)
                self._mint(account, short_key, amount)
                self._emit("ScalarSplit", 1, branch.value, amount)
            else:
                self._proposal_state(
                    VaultState.OPEN, VaultState.RESOLVED, VaultState.VOIDED
                )
                self._ensure_holds(account, long_key, amount)
                self._ensure_holds(account, short_key, amount)
                self.proposal.merge_scalar(branch, amount)
                self._burn(account, long_key, amount)
                self._burn(account, short_key, amount)
                self._mint(account, branch_key, amount)
                self._emit("ScalarMerged", 1, branch.value, amount)
            return {"burned": amount, "minted": amount}

        if name in ("split_gate", "merge_gate"):
            branch = Branch(args["branch"])
            gate = GateType(args["gate"])
            branch_key = _proposal_key(branch, PositionKind.BRANCH_USDC)
            yes_key = _proposal_key(branch, PositionKind.GATE_YES, gate)
            no_key = _proposal_key(branch, PositionKind.GATE_NO, gate)
            if name == "split_gate":
                self._proposal_state(VaultState.OPEN)
                self._ensure_holds(account, branch_key, amount)
                self.proposal.split_gate(branch, gate, amount)
                self._burn(account, branch_key, amount)
                self._mint(account, yes_key, amount)
                self._mint(account, no_key, amount)
                self._emit(
                    "GateSplit", 1, branch.value, gate.value, amount
                )
            else:
                self._proposal_state(
                    VaultState.OPEN, VaultState.RESOLVED, VaultState.VOIDED
                )
                self._ensure_holds(account, yes_key, amount)
                self._ensure_holds(account, no_key, amount)
                self.proposal.merge_gate(branch, gate, amount)
                self._burn(account, yes_key, amount)
                self._burn(account, no_key, amount)
                self._mint(account, branch_key, amount)
                self._emit(
                    "GateMerged", 1, branch.value, gate.value, amount
                )
            return {"burned": amount, "minted": amount}

        if name == "transfer":
            source = args["from"]
            destination = args["to"]
            key = _position_key(args["position"])
            if amount == 0:
                raise _SequenceError("AmountTooSmall")
            if self._balance(destination, key) == 0 and amount < _MIN_LEDGER_AMOUNT:
                raise _SequenceError("AmountTooSmall")
            source_balance = self._balance(source, key)
            remainder = max(source_balance - amount, 0)
            moved = source_balance if 0 < remainder < _MIN_LEDGER_AMOUNT else amount
            if args["position"]["family"] == "proposal":
                self._proposal_state(
                    VaultState.OPEN, VaultState.RESOLVED, VaultState.VOIDED
                )
                self.proposal.transfer(moved)
            else:
                self._baseline_state(BaselineState.OPEN)
                self.baseline.transfer(moved)
            self._burn(source, key, moved)
            self._mint(destination, key, moved)
            self._emit("PositionTransferred", key, moved)
            return {"moved": moved}

        if name == "resolve":
            self._proposal_state(VaultState.OPEN)
            self.proposal.resolve(Branch(args["winner"]))
            self._emit("VaultResolved", 1, args["winner"])
            return {}

        if name == "void":
            self._proposal_state(VaultState.OPEN, VaultState.RESOLVED)
            self.proposal.void()
            self._emit("VaultVoided", 1)
            return {}

        if name == "settle_scalar":
            score = self._score(args["s"])
            self._proposal_state(VaultState.RESOLVED)
            self.proposal.settle_scalar(score)
            self._emit(
                "ScalarSettlementSet",
                1,
                self.proposal.winner.value,
                args["s"],
            )
            return {"s": args["s"]}

        if name == "settle_gate":
            gate = GateType(args["gate"])
            self._proposal_state(
                VaultState.RESOLVED, VaultState.SCALAR_SETTLED
            )
            if self.proposal.gate_outcomes[gate] is not None:
                raise _SequenceError("GateAlreadySettled")
            self.proposal.settle_gate(gate, args["outcome"])
            self._emit(
                "GateSettled",
                1,
                self.proposal.winner.value,
                gate.value,
                args["outcome"],
            )
            return {"outcome": args["outcome"]}

        if name == "redeem":
            self._proposal_state(VaultState.SCALAR_SETTLED)
            branch = self.proposal.winner
            key = _proposal_key(branch, PositionKind.BRANCH_USDC)
            self._ensure_holds(account, key, amount)
            payout = self._measure(
                self.proposal, lambda: self.proposal.redeem(branch, amount)
            )
            self._burn(account, key, amount)
            self._emit_redemption("Redeemed", (1,), payout)
            return self._redemption_outcome("Redeemed", amount, payout)

        if name in ("redeem_scalar", "redeem_scalar_pair"):
            self._proposal_state(VaultState.SCALAR_SETTLED)
            branch = self.proposal.winner
            long_key = _proposal_key(branch, PositionKind.LONG)
            short_key = _proposal_key(branch, PositionKind.SHORT)
            protocol = self._is_protocol(account)
            if name == "redeem_scalar_pair":
                self._ensure_holds(account, long_key, amount)
                self._ensure_holds(account, short_key, amount)
                payout = self._measure(
                    self.proposal,
                    lambda: self.proposal.redeem_scalar_pair(
                        branch, amount, protocol_account=protocol
                    ),
                )
                self._burn(account, long_key, amount)
                self._burn(account, short_key, amount)
                event = "ScalarPairRedeemed"
                self._emit_redemption(event, (1,), payout)
            else:
                side = ScalarSide(args["side"])
                key = long_key if side is ScalarSide.LONG else short_key
                self._ensure_holds(account, key, amount)
                payout = self._measure(
                    self.proposal,
                    lambda: self.proposal.redeem_scalar(
                        branch, side, amount, protocol_account=protocol
                    ),
                )
                self._burn(account, key, amount)
                event = "ScalarRedeemed"
                self._emit_redemption(event, (1, side.value), payout)
            return self._redemption_outcome(event, amount, payout)

        if name == "redeem_gate":
            self._proposal_state(VaultState.SCALAR_SETTLED)
            gate = GateType(args["gate"])
            outcome = self.proposal.gate_outcomes[gate]
            if outcome is None:
                raise _SequenceError("GateNotSettled")
            branch = self.proposal.winner
            side = GateSide.YES if outcome else GateSide.NO
            kind = PositionKind.GATE_YES if outcome else PositionKind.GATE_NO
            key = _proposal_key(branch, kind, gate)
            self._ensure_holds(account, key, amount)
            protocol = self._is_protocol(account)
            payout = self._measure(
                self.proposal,
                lambda: self.proposal.redeem_gate(
                    branch,
                    gate,
                    side,
                    amount,
                    protocol_account=protocol,
                ),
            )
            self._burn(account, key, amount)
            self._emit_redemption(
                "GateRedeemed", (1, gate.value), payout
            )
            return self._redemption_outcome(
                "GateRedeemed", amount, payout
            )

        if name == "redeem_void":
            self._proposal_state(VaultState.VOIDED)
            branch = Branch(args["branch"])
            kind = PositionKind(args["kind"])
            gate = GateType(args["gate"]) if "gate" in args else None
            key = _proposal_key(branch, kind, gate)
            self._ensure_holds(account, key, amount)
            payout = self._measure(
                self.proposal,
                lambda: self.proposal.redeem_void(
                    branch, kind, amount, gate
                ),
            )
            self._burn(account, key, amount)
            event_kind = kind.value
            if gate is not None:
                event_kind = f"{event_kind}/{gate.value}"
            # 02 §6 rule 3: `VoidRedeemed` never gains a `fee` field.
            self._emit_redemption(
                "VoidRedeemed", (1, event_kind, amount), payout
            )
            return self._redemption_outcome(
                "VoidRedeemed", amount, payout
            )

        if name == "split_baseline":
            if amount < _MIN_LEDGER_AMOUNT:
                raise _SequenceError("AmountTooSmall")
            self._baseline_state(BaselineState.OPEN)
            self.baseline.split_baseline(amount)
            for side in ScalarSide:
                self._mint(account, _baseline_key(side), amount)
            self._emit("BaselineSplit", 7, amount)
            return {"minted": amount}

        if name == "merge_baseline":
            self._baseline_state(BaselineState.OPEN)
            keys = [_baseline_key(side) for side in ScalarSide]
            for key in keys:
                self._ensure_holds(account, key, amount)
            payout = self.baseline.merge_baseline(amount)
            for key in keys:
                self._burn(account, key, amount)
            self._emit("BaselineMerged", 7, amount)
            return {"burned": amount, "payout": payout}

        if name == "settle_baseline":
            score = self._score(args["s"])
            self._baseline_state(BaselineState.OPEN)
            self.baseline.settle_baseline(score)
            self._emit("BaselineSettled", 7, args["s"])
            return {"s": args["s"]}

        if name in ("redeem_baseline", "redeem_baseline_pair"):
            self._baseline_state(BaselineState.SETTLED)
            long_key = _baseline_key(ScalarSide.LONG)
            short_key = _baseline_key(ScalarSide.SHORT)
            protocol = self._is_protocol(account)
            if name == "redeem_baseline_pair":
                self._ensure_holds(account, long_key, amount)
                self._ensure_holds(account, short_key, amount)
                payout = self._measure(
                    self.baseline,
                    lambda: self.baseline.redeem_baseline_pair(
                        amount, protocol_account=protocol
                    ),
                )
                self._burn(account, long_key, amount)
                self._burn(account, short_key, amount)
                emitted_side = ScalarSide.LONG.value
            else:
                side = ScalarSide(args["side"])
                key = long_key if side is ScalarSide.LONG else short_key
                self._ensure_holds(account, key, amount)
                payout = self._measure(
                    self.baseline,
                    lambda: self.baseline.redeem_baseline(
                        side, amount, protocol_account=protocol
                    ),
                )
                self._burn(account, key, amount)
                emitted_side = side.value
            self._emit_redemption(
                "BaselineRedeemed", (7, emitted_side), payout
            )
            return self._redemption_outcome(
                "BaselineRedeemed", amount, payout
            )

        if name == "sweep_redemption_fees":
            # 03 §5.4 / §5.3a(4): move the whole accrued balance to the fee
            # sink and zero the counter. Touches no escrow and no supply
            # field, so it is outside the §6.5 induction. An empty counter is
            # a **no-op**, not a failure: §5.3a(6) adds no new error and the
            # §8 error list is frozen, so there is nothing to raise.
            swept = (
                self.proposal.sweep_redemption_fees()
                + self.baseline.sweep_redemption_fees()
            )
            self._emit("RedemptionFeesSwept", swept)
            return {"swept": swept}

        raise AssertionError(f"unhandled ledger sequence operation {name}")

    def digest(self):
        proposal_state = {"kind": self.proposal.state.value}
        if self.proposal.state in (
            VaultState.RESOLVED,
            VaultState.SCALAR_SETTLED,
        ):
            proposal_state["winner"] = self.proposal.winner.value
        if self.proposal.state is VaultState.SCALAR_SETTLED:
            proposal_state["s"] = int(
                self.proposal.s * Decimal(1_000_000_000)
            )
        baseline_state = {"kind": self.baseline.state.value}
        if self.baseline.s is not None:
            baseline_state["s"] = int(
                self.baseline.s * Decimal(1_000_000_000)
            )
        positions = []
        totals = {}
        for account in _SEQUENCE_ACCOUNTS:
            for key, balance in sorted(self.balances[account].items()):
                positions.append(
                    {
                        "position": key,
                        "owner": account,
                        "balance": balance,
                        "deposit": _POSITION_DEPOSIT,
                    }
                )
                totals[key] = totals.get(key, 0) + balance
        state = {
            "proposal": {
                "proposal_id": 1,
                "escrowed": self.proposal.escrowed,
                "spec": 0,
                "state": proposal_state,
                "gate_outcomes": {
                    gate.value: self.proposal.gate_outcomes[gate]
                    for gate in GateType
                },
                "branches": {
                    branch.value: {
                        "usdc": self.proposal.branches[branch].usdc,
                        "scalar_sets": self.proposal.branches[
                            branch
                        ].scalar_sets,
                        "gate_sets": {
                            gate.value: self.proposal.branches[
                                branch
                            ].gate_sets[gate]
                            for gate in GateType
                        },
                    }
                    for branch in Branch
                },
            },
            "baseline": {
                "epoch": 7,
                "escrowed": self.baseline.escrowed,
                "sets": self.baseline.sets,
                "state": baseline_state,
            },
            "balances": {
                account: dict(sorted(self.balances[account].items()))
                for account in _SEQUENCE_ACCOUNTS
            },
            # The core differential includes every LedgerState field, not only
            # the protocol aggregates above. These canonicalized views cover
            # PositionRecord deposits, the retained per-owner count records,
            # instrument totals, held deposits, the event log, and protocol
            # exemptions (15 §4.4; scope split from pallet-only sweeps).
            "positions": positions,
            "position_counts": [
                {
                    "owner": account,
                    "count": len(self.balances[account]),
                }
                for account in self.count_accounts
            ],
            "position_totals": [
                {"position": key, "total": total}
                for key, total in sorted(totals.items())
            ],
            "deposits_held": len(positions) * _POSITION_DEPOSIT,
            "events": self.events,
            # 03 §5.3a(1): the fee-exempt claimant set. Empty for every
            # pre-E1 row, so those digests are byte-identical.
            "protocol_accounts": sorted(self.protocol_accounts),
        }
        if self.contract_version >= _CONTRACT_V17:
            # 03 §5.3a(4): `RedemptionFeesAccrued` is real pallet storage, so
            # a differential that compares only `final_state` must be able to
            # see it. It exists only from E1, hence the version gate — the
            # pre-E1 rows describe a runtime that has no such item.
            state["redemption_fees_accrued"] = self.fees_accrued()
        return state


def _op(name, **args):
    return {"op": name, "args": args}


def _position(branch, kind, gate=None):
    position = {
        "family": "proposal",
        "branch": branch.value,
        "kind": kind.value,
    }
    if gate is not None:
        position["gate"] = gate.value
    return position


def _base_position(side):
    return {"family": "baseline", "side": side.value}


def _sequence_program(index, rng):
    intent = _SEQUENCE_INTENTS[index % len(_SEQUENCE_INTENTS)]
    winner = Branch.ACCEPT if rng.getrandbits(1) == 0 else Branch.REJECT
    other = Branch.REJECT if winner is Branch.ACCEPT else Branch.ACCEPT
    gate = GateType.SURVIVAL if rng.getrandbits(1) == 0 else GateType.SECURITY
    other_gate = (
        GateType.SECURITY
        if gate is GateType.SURVIVAL
        else GateType.SURVIVAL
    )
    outcome = bool(rng.getrandbits(1))
    score = rng.choice(
        (1, 123_456_789, 333_333_333, 500_000_001, 700_050_001, 999_999_999)
    )
    baseline_score = rng.choice(
        (1, 250_000_001, 500_000_001, 700_050_001, 999_999_999)
    )
    amount = 200_001 + 2 * rng.randrange(0, 10_000)
    scalar = 40_003 + 2 * rng.randrange(0, 2_000)
    gate_amount = 30_005 + 2 * rng.randrange(0, 2_000)
    second_gate_amount = 20_007 + 2 * rng.randrange(0, 2_000)
    base_amount = 100_003 + 2 * rng.randrange(0, 5_000)

    ops = [
        _op("split", account="alice", amount=9_999),
        _op("redeem", account="alice", amount=10_001),
        _op("split", account="alice", amount=amount),
    ]
    for branch in Branch:
        ops.extend(
            [
                _op(
                    "split_scalar",
                    account="alice",
                    branch=branch.value,
                    amount=scalar,
                ),
                _op(
                    "merge_scalar",
                    account="alice",
                    branch=branch.value,
                    amount=10_001,
                ),
                _op(
                    "split_gate",
                    account="alice",
                    branch=branch.value,
                    gate=gate.value,
                    amount=gate_amount,
                ),
                _op(
                    "merge_gate",
                    account="alice",
                    branch=branch.value,
                    gate=gate.value,
                    amount=10_003,
                ),
                _op(
                    "split_gate",
                    account="alice",
                    branch=branch.value,
                    gate=other_gate.value,
                    amount=second_gate_amount,
                ),
            ]
        )
    ops.extend(
        [
            _op(
                "transfer",
                **{
                    "from": "alice",
                    "to": "bob",
                    "position": _position(
                        winner, PositionKind.BRANCH_USDC
                    ),
                    "amount": 10_001,
                },
            ),
            _op(
                "transfer",
                **{
                    "from": "alice",
                    "to": "carol",
                    "position": _position(winner, PositionKind.SHORT),
                    "amount": 10_003,
                },
            ),
            _op(
                "transfer",
                **{
                    "from": "alice",
                    "to": "bob",
                    "position": _position(other, PositionKind.LONG),
                    "amount": 9_999,
                },
            ),
            _op("settle_scalar", s=score),
            _op("split_baseline", account="alice", amount=base_amount),
            _op("merge_baseline", account="alice", amount=20_001),
            _op(
                "transfer",
                **{
                    "from": "alice",
                    "to": "bob",
                    "position": _base_position(ScalarSide.LONG),
                    "amount": 30_001,
                },
            ),
            _op("settle_baseline", s=1_000_000_001),
            _op("settle_baseline", s=baseline_score),
            _op("merge_baseline", account="alice", amount=10_001),
            _op(
                "redeem_baseline",
                account="bob",
                side=ScalarSide.LONG.value,
                amount=10_001,
            ),
            _op(
                "redeem_baseline_pair", account="alice", amount=20_003
            ),
            _op(
                "redeem_baseline",
                account="alice",
                side=ScalarSide.SHORT.value,
                amount=10_003,
            ),
        ]
    )

    if intent == "void-after-open":
        ops.extend(
            [
                _op("void"),
                _op("resolve", winner=winner.value),
                _op(
                    "merge_scalar",
                    account="alice",
                    branch=winner.value,
                    amount=10_001,
                ),
                _op(
                    "merge_gate",
                    account="alice",
                    branch=winner.value,
                    gate=gate.value,
                    amount=10_003,
                ),
                _op("merge", account="alice", amount=10_001),
                _op(
                    "redeem_void",
                    account="carol",
                    branch=winner.value,
                    kind=PositionKind.SHORT.value,
                    amount=10_003,
                ),
                _op(
                    "redeem_void",
                    account="alice",
                    branch=winner.value,
                    kind=PositionKind.LONG.value,
                    amount=10_005,
                ),
            ]
        )
    elif intent == "void-after-resolved":
        ops.extend(
            [
                _op("resolve", winner=winner.value),
                _op("split", account="alice", amount=10_001),
                _op("void"),
                _op("settle_scalar", s=score),
                _op(
                    "redeem_void",
                    account="bob",
                    branch=winner.value,
                    kind=PositionKind.BRANCH_USDC.value,
                    amount=10_001,
                ),
                _op(
                    "redeem_void",
                    account="alice",
                    branch=other.value,
                    kind=PositionKind.GATE_YES.value,
                    gate=gate.value,
                    amount=10_005,
                ),
            ]
        )
    else:
        ops.extend(
            [
                _op("resolve", winner=winner.value),
                _op("settle_scalar", s=1_000_000_001),
                _op("settle_gate", gate=gate.value, outcome=outcome),
                _op("settle_gate", gate=gate.value, outcome=not outcome),
                _op("redeem_gate", account="alice", gate=other_gate.value, amount=10_001),
                _op("settle_scalar", s=score),
                _op("void"),
                _op("redeem", account="alice", amount=10_005),
                _op(
                    "redeem_scalar_pair", account="alice", amount=10_001
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=10_003,
                ),
                _op(
                    "redeem_scalar",
                    account="carol",
                    side=ScalarSide.SHORT.value,
                    amount=10_003,
                ),
                _op(
                    "redeem_gate",
                    account="alice",
                    gate=gate.value,
                    amount=10_005,
                ),
            ]
        )

    # Seeded post-terminal operations deliberately mix legal and illegal calls.
    # This gives every scenario a different program while the intent-specific
    # prefix guarantees the required gate/Baseline/VOID/pair paths.
    random_ops = (
        lambda: _op("split", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((1, 9_999, 10_001, 20_003))),
        lambda: _op("merge", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("split_scalar", account=rng.choice(_SEQUENCE_ACCOUNTS), branch=rng.choice(tuple(Branch)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("merge_scalar", account=rng.choice(_SEQUENCE_ACCOUNTS), branch=rng.choice(tuple(Branch)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("split_gate", account=rng.choice(_SEQUENCE_ACCOUNTS), branch=rng.choice(tuple(Branch)).value, gate=rng.choice(tuple(GateType)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("merge_gate", account=rng.choice(_SEQUENCE_ACCOUNTS), branch=rng.choice(tuple(Branch)).value, gate=rng.choice(tuple(GateType)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_scalar", account=rng.choice(_SEQUENCE_ACCOUNTS), side=rng.choice(tuple(ScalarSide)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_scalar_pair", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_gate", account=rng.choice(_SEQUENCE_ACCOUNTS), gate=rng.choice(tuple(GateType)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_void", account=rng.choice(_SEQUENCE_ACCOUNTS), branch=rng.choice(tuple(Branch)).value, kind=PositionKind.BRANCH_USDC.value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("merge_baseline", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_baseline", account=rng.choice(_SEQUENCE_ACCOUNTS), side=rng.choice(tuple(ScalarSide)).value, amount=rng.choice((0, 10_001, 99_999))),
        lambda: _op("redeem_baseline_pair", account=rng.choice(_SEQUENCE_ACCOUNTS), amount=rng.choice((0, 10_001, 99_999))),
    )
    for _ in range(10):
        ops.append(rng.choice(random_ops)())

    if intent == "illegal-terminal-interleavings":
        ops.extend(
            [
                _op("resolve", winner=other.value),
                _op("settle_gate", gate=other_gate.value, outcome=True),
                _op("settle_baseline", s=500_000_000),
                _op(
                    "transfer",
                    **{
                        "from": "alice",
                        "to": "bob",
                        "position": _position(
                            winner, PositionKind.BRANCH_USDC
                        ),
                        "amount": 10_001,
                    },
                ),
            ]
        )
    return intent, ops


def _ledger_sequence_scenarios():
    scenarios = []
    master = random.Random(_LEDGER_SEQUENCE_SEED)
    for index in range(64):
        seed = master.getrandbits(64)
        rng = random.Random(seed)
        model = _LedgerSequenceModel()
        initial = model.digest()
        intent, operations = _sequence_program(index, rng)
        rows = []
        for operation in operations:
            row = dict(operation)
            row["outcome"] = model.apply(operation)
            rows.append(row)
        model.proposal.check_conservation()
        model.baseline.check_conservation()
        scenarios.append(
            {
                "name": f"ledger-sequence-{index:02d}-{intent}",
                "seed": f"0x{seed:016X}",
                "coverage_intent": intent,
                "initial_state": {
                    "proposal_id": 1,
                    "baseline_epoch": 7,
                    "digest": initial,
                },
                "ops": rows,
                "final_state": model.digest(),
            }
        )
    return scenarios


def _ledger_score_scenarios():
    """03 §6.3 endpoint and k±1 settlement-score differential rows."""

    amount = 20_003
    rows = []
    for score in _ROUNDING_SCORES:
        factor = Decimal(score) / Decimal(1_000_000_000)

        long_vault = Vault()
        long_vault.split(amount)
        long_vault.split_scalar(Branch.ACCEPT, amount)
        long_vault.resolve(Branch.ACCEPT)
        long_vault.settle_scalar(factor)
        long_payout = long_vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.LONG, amount
        )

        short_vault = Vault()
        short_vault.split(amount)
        short_vault.split_scalar(Branch.ACCEPT, amount)
        short_vault.resolve(Branch.ACCEPT)
        short_vault.settle_scalar(factor)
        short_payout = short_vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.SHORT, amount
        )

        pair_vault = Vault()
        pair_vault.split(amount)
        pair_vault.split_scalar(Branch.ACCEPT, amount)
        pair_vault.resolve(Branch.ACCEPT)
        pair_vault.settle_scalar(factor)
        pair_payout = pair_vault.redeem_scalar_pair(
            Branch.ACCEPT, amount
        )

        rows.append(
            {
                "name": f"score-{score:010d}",
                "score": score,
                "amount": amount,
                "long_payout": long_payout,
                "short_payout": short_payout,
                "pair_payout": pair_payout,
            }
        )
    return rows


# 03 §5.3a / 15 §4.3 "rate coverage": the fee-bearing redemption corpus.
# Every row is a standalone program — it carries the rate, the `min_split`
# waiver threshold and the exempt-account set alongside its ops, so a port
# replays it without consulting 13. The op alphabet and the `outcome` shape are
# exactly those of `ledger_sequence_scenarios`; the per-op `gross`/`fee`/`net`
# triple and the accrual counters are the only new fields.
_PAYOUT_OPS = frozenset(
    {
        "merge",
        "merge_baseline",
        "redeem",
        "redeem_scalar",
        "redeem_scalar_pair",
        "redeem_gate",
        "redeem_void",
        "redeem_baseline",
        "redeem_baseline_pair",
    }
)


# Appended to every fee row's `coverage_intent`. 02 §6 rule 1 splits the two
# quantities across two surfaces, and a porter who swaps them ships a frozen
# event that is wrong forever — so each row says which is which, standalone.
_FEE_INTENT_SUFFIX = (
    " [contract v17 shape: the event and this row's `outcome.payout` carry "
    "the GROSS with a trailing `fee`, so net = payout - fee (02 §6 rule 1); "
    "the dispatch/model return value is the NET. `Redeemed` and "
    "`VoidRedeemed` are exempt and carry no `fee` field at all (rule 3).]"
)


def _fee_scenario(name, intent, params, operations):
    model = _LedgerSequenceModel(contract_version=_CONTRACT_V17, **params)
    initial = model.digest()
    rows = []
    for operation in operations:
        row = dict(operation)
        charged_before = model.fees_charged_total()
        gross_before = (
            model.proposal.total_payouts + model.baseline.total_payouts
        )
        row["outcome"] = model.apply(operation)
        fee = model.fees_charged_total() - charged_before
        gross = (
            model.proposal.total_payouts + model.baseline.total_payouts
        ) - gross_before
        if operation["op"] in _PAYOUT_OPS and "ok" in row["outcome"]:
            # 03 §5.3a(4)/§6.5: `gross` is measured here as the escrow outflow
            # and `fee` as the accrual-counter delta, independently of what
            # the model reported, so the identity below is a real check.
            net = gross - fee
            emitted = row["outcome"]["ok"]
            if emitted["payout"] != gross:
                raise AssertionError(
                    f"{name}/{operation['op']}: emitted payout "
                    f"{emitted['payout']} is not the gross {gross}"
                )
            if emitted.get("fee", 0) != fee:
                raise AssertionError(
                    f"{name}/{operation['op']}: emitted fee "
                    f"{emitted.get('fee')} != {fee}"
                )
            if net + fee != gross:
                raise AssertionError(
                    f"{name}/{operation['op']}: net {net} + fee {fee} "
                    f"!= gross {gross}"
                )
            row["gross"] = gross
            row["fee"] = fee
            row["net"] = net
        elif fee:
            raise AssertionError(f"{name}: non-payout op accrued a fee")
        row["fees_accrued_after"] = model.fees_accrued()
        rows.append(row)
    model.proposal.check_conservation()
    model.baseline.check_conservation()
    return {
        "name": name,
        "unit": "USDC base units (1e-6)",
        "coverage_intent": intent + _FEE_INTENT_SUFFIX,
        "params": {
            "contract_version": _CONTRACT_V17,
            "redeem_fee_perbill": params["redeem_fee"],
            "min_split": params.get("min_split", MIN_SPLIT),
            "protocol_accounts": sorted(params.get("protocol_accounts", ())),
        },
        "initial_state": {
            "proposal_id": 1,
            "baseline_epoch": 7,
            "digest": initial,
        },
        "ops": rows,
        "fees_accrued": model.fees_accrued(),
        "fees_charged_total": model.fees_charged_total(),
        "fees_swept_total": model.fees_swept_total(),
        "final_state": model.digest(),
    }


def _ledger_fee_scenarios():
    """03 §5.3a: charged calls, every exemption, the waiver, and the sweep."""

    default = {"redeem_fee": DEFAULT_REDEEM_FEE_PERBILL}
    scenarios = [
        _fee_scenario(
            "fee-01-scalar-legs-charged-waived-and-swept",
            "redeem_scalar charged with ceil != floor (42.003 -> 43); the "
            "mirror leg's gross falls under ledger.min_split and is waived; "
            "sweep_redemption_fees zeroes the counter",
            default,
            [
                _op("split", account="alice", amount=20_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=20_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=700_050_000),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=20_000,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.SHORT.value,
                    amount=20_000,
                ),
                _op("sweep_redemption_fees"),
                _op("sweep_redemption_fees"),
            ],
        ),
        _fee_scenario(
            "fee-02-pair-equals-leg-by-leg-under-the-waiver",
            "03 §5.3a(2a) PT-7 witness: identical holdings redeemed as a "
            "pair and leg-by-leg at the same rate and score. The pair's fee "
            "base is its own two legs, so both routes now net 19957 — the "
            "pair is never the worse choice. Charging fee(a) on the combined "
            "gross instead would net the pair 19940",
            default,
            [
                _op("split", account="alice", amount=40_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=40_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=700_050_000),
                _op(
                    "redeem_scalar_pair", account="alice", amount=20_000
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=20_000,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.SHORT.value,
                    amount=20_000,
                ),
            ],
        ),
        _fee_scenario(
            "fee-03-gate-winning-side-charged",
            "redeem_gate on the winning side is charged at the full 1:1 gross",
            default,
            [
                _op("split", account="alice", amount=1_000_000),
                _op(
                    "split_gate",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    gate=GateType.SURVIVAL.value,
                    amount=1_000_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op(
                    "settle_gate",
                    gate=GateType.SURVIVAL.value,
                    outcome=True,
                ),
                _op("settle_scalar", s=500_000_000),
                _op(
                    "redeem_gate",
                    account="alice",
                    gate=GateType.SURVIVAL.value,
                    amount=1_000_000,
                ),
            ],
        ),
        _fee_scenario(
            "fee-04-par-leg-and-merge-are-exempt",
            "03 §5.3a(1): `merge` and the `redeem` par leg pay no fee at a "
            "non-zero rate — G-3 and I-5's 1:1 guarantee survive verbatim",
            default,
            [
                _op("split", account="alice", amount=2_000_000),
                _op("merge", account="alice", amount=1_000_000),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=500_000_000),
                _op("redeem", account="alice", amount=1_000_000),
            ],
        ),
        _fee_scenario(
            "fee-05-void-and-scalar-merge-are-exempt",
            "03 §5.3a(1): nothing admissible under `Voided` is fee-bearing, "
            "so §6.4's D-1 valuation argument is unchanged",
            default,
            [
                _op("split", account="alice", amount=1_000_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=400_000,
                ),
                _op("void"),
                _op(
                    "merge_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=400_000,
                ),
                _op("merge", account="alice", amount=500_000),
                _op(
                    "redeem_void",
                    account="alice",
                    branch=Branch.REJECT.value,
                    kind=PositionKind.BRANCH_USDC.value,
                    amount=500_000,
                ),
            ],
        ),
        _fee_scenario(
            "fee-06-baseline-legs-charged-merge-exempt",
            "redeem_baseline and redeem_baseline_pair are charged; "
            "merge_baseline is exempt; the counter accrues across vaults",
            default,
            [
                _op("split_baseline", account="alice", amount=3_000_000),
                _op("merge_baseline", account="alice", amount=1_000_000),
                _op("settle_baseline", s=700_050_000),
                _op(
                    "redeem_baseline",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=1_000_000,
                ),
                _op(
                    "redeem_baseline_pair",
                    account="alice",
                    amount=1_000_000,
                ),
                _op("sweep_redemption_fees"),
            ],
        ),
        _fee_scenario(
            "fee-07-net-waiver-boundary-at-min-balance",
            "03 §5.3a(2)/I-32(b): the waiver tests the NET. A gross of "
            "exactly min_balance (10000) is waived and nets 10000 — a "
            "gross-based test would have charged it 30 and netted 9970, "
            "below min_balance, on the very BelowMinimum path the waiver "
            "removes. 10030 is the last waived gross and 10031 the first "
            "charged one, and it nets exactly min_balance",
            default,
            [
                _op("split", account="alice", amount=100_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=PERBILL_ONE),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=9_999,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=10_000,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=10_030,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=10_031,
                ),
            ],
        ),
        _fee_scenario(
            "fee-08-protocol-account-is-exempt",
            "03 §5.3a(1): identical redemptions by a claimant and by a "
            "ProtocolAccount; only the claimant is charged. The protocol "
            "holder acquires its inventory through the §5.5 MarketAuthority "
            "wrapper, modelled here as a direct split",
            {
                "redeem_fee": DEFAULT_REDEEM_FEE_PERBILL,
                "protocol_accounts": ("carol",),
            },
            [
                _op("split", account="alice", amount=100_000),
                _op("split", account="carol", amount=100_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op(
                    "split_scalar",
                    account="carol",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=PERBILL_ONE),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=100_000,
                ),
                _op(
                    "redeem_scalar",
                    account="carol",
                    side=ScalarSide.LONG.value,
                    amount=100_000,
                ),
            ],
        ),
        _fee_scenario(
            "fee-09-full-rate-collects-nothing-under-the-net-waiver",
            "I-31 at a hypothetical 100 % rate: the net-based waiver always "
            "fires because the net would be 0, so nothing is charged and the "
            "claimant is paid in full. The rate governs distribution, never "
            "solvency — and the waiver bounds it from the claimant's side",
            {"redeem_fee": PERBILL_ONE},
            [
                _op("split", account="alice", amount=100_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=PERBILL_ONE),
                _op(
                    "redeem_scalar_pair", account="alice", amount=100_000
                ),
                _op("sweep_redemption_fees"),
            ],
        ),
        _fee_scenario(
            "fee-10-out-of-domain-rate-reads-as-zero",
            "03 §5.3a(5)/I-32(d): a rate outside the Perbill domain is a "
            "malformed record and reads as 0 — the fail-OPEN direction, "
            "because it is the claimant-favouring one",
            {"redeem_fee": PERBILL_ONE + 1},
            [
                _op("split", account="alice", amount=100_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=PERBILL_ONE),
                _op(
                    "redeem_scalar_pair", account="alice", amount=100_000
                ),
            ],
        ),
        _fee_scenario(
            "fee-11-high-rate-charges-above-the-net-threshold",
            "At 50 % the net-based waiver moves the charging threshold to "
            "2·min_split: a 19999 gross is waived outright while a 20000 "
            "gross is charged 10000 and nets exactly min_split. fee <= gross "
            "at every rate (I-32(a))",
            {"redeem_fee": 500_000_000},
            [
                _op("split", account="alice", amount=100_000),
                _op(
                    "split_scalar",
                    account="alice",
                    branch=Branch.ACCEPT.value,
                    amount=100_000,
                ),
                _op("resolve", winner=Branch.ACCEPT.value),
                _op("settle_scalar", s=PERBILL_ONE),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=19_999,
                ),
                _op(
                    "redeem_scalar",
                    account="alice",
                    side=ScalarSide.LONG.value,
                    amount=20_000,
                ),
                _op("sweep_redemption_fees"),
            ],
        ),
    ]
    return scenarios


def _ledger_sweep_scenarios():
    """03 §5.4 expectations for the FRAME-only housekeeping surface.

    The aggregate Python ledger derives the residue and the per-holder model
    derives the live entry/deposit counts. Archive time, bounded prefix scans,
    refunds, custody, and storage removal are deliberately exercised only by
    the pallet consumer; the frame-free core has no sweep operation.
    """

    rows = []

    proposal = _LedgerSequenceModel()
    proposal_ops = [
        _op("split", account="alice", amount=1_000_003),
        _op(
            "transfer",
            **{
                "from": "alice",
                "to": "bob",
                "position": _position(
                    Branch.REJECT, PositionKind.BRANCH_USDC
                ),
                "amount": 1_000_003,
            },
        ),
        _op(
            "split_scalar",
            account="alice",
            branch=Branch.ACCEPT.value,
            amount=400_003,
        ),
        _op(
            "transfer",
            **{
                "from": "alice",
                "to": "carol",
                "position": _position(
                    Branch.ACCEPT, PositionKind.SHORT
                ),
                "amount": 100_001,
            },
        ),
        _op(
            "split_gate",
            account="bob",
            branch=Branch.REJECT.value,
            gate=GateType.SURVIVAL.value,
            amount=300_005,
        ),
        _op("void"),
    ]
    proposal_setup = []
    for operation in proposal_ops:
        row = dict(operation)
        row["outcome"] = proposal.apply(operation)
        if "err" in row["outcome"]:
            raise AssertionError(f"invalid proposal sweep setup: {row}")
        proposal_setup.append(row)
    proposal_counts = {
        account: sum(
            key.startswith("proposal/")
            for key in proposal.balances[account]
        )
        for account in _SEQUENCE_ACCOUNTS
    }
    proposal_entries = sum(proposal_counts.values())
    proposal_batch = 3
    rows.append(
        {
            "name": "proposal-voided-pair-residue",
            "family": "proposal",
            "id": 1,
            "reap_batch": proposal_batch,
            "setup_ops": proposal_setup,
            "expected_residue": proposal.proposal.escrowed,
            "expected_entries": proposal_entries,
            "expected_batches": (
                proposal_entries + proposal_batch - 1
            )
            // proposal_batch,
            "expected_refunds": {
                account: count * _POSITION_DEPOSIT
                for account, count in proposal_counts.items()
            },
        }
    )

    baseline = _LedgerSequenceModel()
    baseline_ops = [
        _op("split_baseline", account="alice", amount=800_005),
        _op(
            "transfer",
            **{
                "from": "alice",
                "to": "bob",
                "position": _base_position(ScalarSide.LONG),
                "amount": 200_001,
            },
        ),
        _op(
            "transfer",
            **{
                "from": "alice",
                "to": "carol",
                "position": _base_position(ScalarSide.SHORT),
                "amount": 100_003,
            },
        ),
        _op("settle_baseline", s=700_050_001),
    ]
    baseline_setup = []
    for operation in baseline_ops:
        row = dict(operation)
        row["outcome"] = baseline.apply(operation)
        if "err" in row["outcome"]:
            raise AssertionError(f"invalid Baseline sweep setup: {row}")
        baseline_setup.append(row)
    baseline_counts = {
        account: sum(
            key.startswith("baseline/")
            for key in baseline.balances[account]
        )
        for account in _SEQUENCE_ACCOUNTS
    }
    baseline_entries = sum(baseline_counts.values())
    baseline_batch = 2
    rows.append(
        {
            "name": "baseline-settled-rounding-residue",
            "family": "baseline",
            "id": 7,
            "reap_batch": baseline_batch,
            "setup_ops": baseline_setup,
            "expected_residue": baseline.baseline.escrowed,
            "expected_entries": baseline_entries,
            "expected_batches": (
                baseline_entries + baseline_batch - 1
            )
            // baseline_batch,
            "expected_refunds": {
                account: count * _POSITION_DEPOSIT
                for account, count in baseline_counts.items()
            },
        }
    )
    return rows


def _ledger_error_scenarios():
    """One generated operation witness for every Rust mapping-table class."""

    rows = [
        ("unknown-vault", "split", "UnknownVault"),
        (
            "unknown-baseline-vault",
            "split_baseline",
            "UnknownBaselineVault",
        ),
        ("wrong-vault-state", "split_after_resolve", "WrongVaultState"),
        ("amount-too-small", "split_below_minimum", "AmountTooSmall"),
        ("arithmetic-overflow", "split_overflow", "ArithmeticOverflow"),
        (
            "insufficient-position",
            "merge_without_positions",
            "InsufficientPosition",
        ),
        (
            "position-cap-exceeded",
            "split_at_position_cap",
            "PositionCapExceeded",
        ),
        ("invalid-score", "settle_invalid_score", "InvalidScore"),
        (
            "gate-already-settled",
            "settle_gate_twice",
            "GateAlreadySettled",
        ),
        (
            "gate-not-settled",
            "redeem_unsettled_gate",
            "GateNotSettled",
        ),
    ]
    return [
        {
            "name": name,
            "op": {"name": operation},
            "outcome": {"err": error_class},
        }
        for name, operation, error_class in rows
    ]


def _treasury_scenarios():
    rows = []
    for name in ("Param", "Treasury", "Code", "Meta"):
        rows.append(
            {
                "name": f"{name.lower()}_pol",
                "inputs": {"proposal_class": name},
                "commitment": format(pol_commitment(name), "f"),
                "commitment_display": display_integer(pol_commitment(name)),
                "nav_floor": format(nav_floor(name), "f"),
                "nav_floor_display": display_integer(nav_floor(name)),
            }
        )
    code_nav = Decimal("13862944")
    prize = in_cap_prize(
        "Code", spendable_nav=code_nav, ask=0, envelope=0
    )
    volume = dec_v_min("Code", prize)
    depth = Decimal(2) * Decimal("60000") * Decimal(
        "0.6931471805599453094172321214581765680755001343602552541206800094933936219696947156058633269964186875"
    )
    attack = attack_cost_hat(depth + volume)
    rows.extend(
        [
            {
                "name": "baseline_commitment",
                "inputs": {"b": "25000"},
                "commitment": format(baseline_commitment(), "f"),
                "commitment_display": display_integer(baseline_commitment()),
            },
            {
                "name": "code_security_at_nav_floor",
                "inputs": {"spendable_nav": format(code_nav, "f")},
                "prize": format(prize, "f"),
                "dec_v_min": format(volume, "f"),
                "pol_depth": format(depth, "f"),
                "liquidity": format(depth + volume, "f"),
                "attack_cost": format(attack, "f"),
                "three_prize": format(Decimal(3) * prize, "f"),
                "attack_cost_third": format(attack / Decimal(3), "f"),
                "security_ok": security_sizing_ok(prize, attack),
            },
            {
                "name": "scaled_defaults",
                "inputs": {"prize": "693147"},
                "pol_b": format(pol_b("Code", Decimal("693147")), "f"),
                "delta": format(
                    decision_delta("Code", Decimal("693147")), "f"
                ),
                "p_ref": format(p_ref("Code"), "f"),
            },
        ]
    )
    # SQ-231: L-hat's non-POL term is min(contest capital (04 §7a),
    # sec.flow_cap·(b_acc+b_rej)) — 08 §5.2.
    treasury_pair = {
        "pol_depth": "34657.359028",
        "b_accept": "25000",
        "b_reject": "25000",
    }
    for name, contest, cap in [
        ("l_hat_contest_within_ceiling", "400000", "8"),
        ("l_hat_flow_cap_ceiling_binds", "1000000000", "7"),
    ]:
        inputs = dict(treasury_pair, contest_capital=contest, flow_cap=cap)
        liquidity = l_hat(
            inputs["pol_depth"],
            inputs["contest_capital"],
            inputs["flow_cap"],
            inputs["b_accept"],
            inputs["b_reject"],
        )
        rows.append(
            {
                "name": name,
                "inputs": inputs,
                "l_hat": format(liquidity, "f"),
                "attack_cost": format(attack_cost_hat(liquidity), "f"),
            }
        )
    return rows


# 04 §7 per-window staleness: `(name, start, end, observation blocks)`. The
# price path is irrelevant to the rule — staleness is block geometry alone — so
# every observation replays the unchanged 0.500 quote and the recorded value
# never leaves the neutral price. Each row is chosen to separate the window
# rule from the book-level running counter:
#
#   * `terminal_gap_at_close` — the gap the observe-only counter cannot see.
#   * `dense_window_is_fresh` — the control: a fully cranked window is clean.
#   * `pre_window_quiet_not_charged` — the clipping leg; the same block geometry
#     scores 1 if the gap is measured from the last observation *before* the
#     window instead of from the window start.
#   * `mid_and_terminal_gaps_force_reject` — two events (one interior, one
#     terminal) is the 04 §7 reject threshold; it also pins the boundary, since
#     the exactly-50 interval must NOT count.
#   * `unobserved_window_is_one_gap` — an entirely uncranked window is one gap,
#     not one per missed interval.
WINDOW_STALE_SCENARIOS = [
    ("terminal_gap_at_close", 0, 200, list(range(10, 101, 10))),
    ("dense_window_is_fresh", 0, 200, list(range(10, 201, 10))),
    ("pre_window_quiet_not_charged", 100, 200, [20] + list(range(140, 201, 10))),
    ("mid_and_terminal_gaps_force_reject", 0, 300, [10, 100, 150]),
    ("unobserved_window_is_one_gap", 0, 100, []),
]


def _window_stale_row(name, start, end, observations):
    """04 §7 window-staleness vectors: gaps > 50 blocks inside [start, end],
    terminal gap included, measured from the window start rather than from an
    observation that precedes the window."""
    accumulator = TwapAccumulator(Decimal("0.500"))
    for block in observations:
        accumulator.observe(block, Decimal("0.500"))
    return {
        "name": name,
        "inputs": {
            "start": start,
            "end": end,
            "observations": list(observations),
            "stale_gap_blocks": STALE_GAP_BLOCKS,
        },
        "stale_events": accumulator.stale_events_in(start, end),
    }


def _contest_scenarios():
    """04 §7a contest-capital accumulator vectors (SQ-231)."""
    rows = []
    wash = ContestCapitalAccumulator()
    wash_observations = [
        {"block": 10, "q_long": "0", "q_short": "0", "price_long": "0.5"},
        {"block": 20, "q_long": "0", "q_short": "0", "price_long": "0.5"},
    ]
    wash_recorded = [
        wash.observe(
            o["block"], o["q_long"], o["q_short"], o["price_long"]
        )
        for o in wash_observations
    ]
    rows.append(
        {
            "name": "wash_round_trip_zero",
            "inputs": {
                "q_pol_long": "0",
                "q_pol_short": "0",
                "observations": wash_observations,
            },
            "recorded": [format(noi, "f") for noi in wash_recorded],
            "contest_capital_0_20": format(wash.mean(0, 20), "f"),
        }
    )
    price = fmt(marginal_price_long(10000, 1000, 0))
    held = ContestCapitalAccumulator()
    held_observations = [
        {"block": 10, "q_long": "1000", "q_short": "0", "price_long": price},
        {"block": 20, "q_long": "1000", "q_short": "0", "price_long": price},
        {"block": 30, "q_long": "1000", "q_short": "0", "price_long": price},
    ]
    held_recorded = [
        held.observe(
            o["block"], o["q_long"], o["q_short"], o["price_long"]
        )
        for o in held_observations
    ]
    rows.append(
        {
            "name": "held_exposure_marks_capital_times_time",
            "inputs": {
                "q_pol_long": "0",
                "q_pol_short": "0",
                "observations": held_observations,
            },
            "recorded": [format(noi, "f") for noi in held_recorded],
            "contest_capital_0_30": format(held.mean(0, 30), "f"),
            "contest_capital_10_30": format(held.mean(10, 30), "f"),
            "cumulative_at_30": format(held.cumulative_at(30), "f"),
        }
    )
    pol = ContestCapitalAccumulator(
        q_pol_long="1000", q_pol_short="1000"
    )
    pol_observations = [
        {
            "block": 10,
            "q_long": "1000",
            "q_short": "1000",
            "price_long": "0.5",
        },
        {
            "block": 20,
            "q_long": "1500",
            "q_short": "1000",
            "price_long": "0.5",
        },
    ]
    pol_recorded = [
        pol.observe(o["block"], o["q_long"], o["q_short"], o["price_long"])
        for o in pol_observations
    ]
    rows.append(
        {
            "name": "pol_seeded_positions_excluded",
            "inputs": {
                "q_pol_long": "1000",
                "q_pol_short": "1000",
                "observations": pol_observations,
            },
            "recorded": [format(noi, "f") for noi in pol_recorded],
            "contest_capital_0_20": format(pol.mean(0, 20), "f"),
        }
    )
    return rows


def _transcendental_corpus():
    """04 §4/§5 per-commit adversarial transcendental corpus (≥10³ points).

    Dense-bit fractional inputs (uniform 64-bit draws average ~32 set bits) plus
    a spread of magnitudes and structured edges. Deterministic: a fixed-seed
    Mersenne Twister driven only through `getrandbits` (stable across CPython
    versions), so the committed corpus regenerates byte-identically (rule 3).
    Every row is standalone-replayable from its raw 64.64 input.
    """
    import random

    q64 = 1 << 64
    rng = random.Random(0xB1EA_1770_C0DE_F1AE)
    rows = []

    def value_of(raw):
        return Decimal(raw) / Decimal(q64)

    def push(function, input_raw, value):
        rows.append(
            {
                "f": function,
                "in": input_raw,
                "out": raw_64x64_nearest(value),
            }
        )

    # exp2 — dense fractional inputs (the [1,2) kernel bound is tight here) …
    for _ in range(640):
        frac = rng.getrandbits(64)
        push("exp2", frac, ref_exp2(value_of(frac)))
    # … and a spread of integer parts across the whole domain [1, 63] to exercise
    # the post-kernel left shift, including the top octave near the 2^64 ceiling.
    for _ in range(200):
        whole = 1 + (rng.getrandbits(8) % 63)
        frac = rng.getrandbits(64)
        raw = (whole << 64) | frac
        push("exp2", raw, ref_exp2(value_of(raw)))
    for frac in (
        q64 - 1,
        (q64 - 1) & 0xAAAAAAAAAAAAAAAA,
        (q64 - 1) & 0x5555555555555555,
        0xFFFFFFFF00000000,
        0x00000000FFFFFFFF,
        0xF0F0F0F0F0F0F0F0,
    ):
        push("exp2", frac, ref_exp2(value_of(frac)))

    # log2 / ln — values ≥ 1 with dense mantissae across the full magnitude range
    # (wide inputs are where a 64-bit-wide log2 drifted past 2 ulp).
    # bits ∈ [65, 128] covers value ∈ [1, 2^64): the top band (bits 128, value near
    # 2^64) is the wide-input edge where an unguarded log2 drifted past 2 ulp.
    for function, ref in (("log2", ref_log2), ("ln", ref_ln)):
        for _ in range(220):
            bits = 65 + (rng.getrandbits(8) % 64)
            raw = (1 << (bits - 1)) | rng.getrandbits(bits - 1)
            push(function, raw, ref(value_of(raw)))

    return {
        "count": len(rows),
        "seed": "0xB1EA1770C0DEF1AE",
        "exp2_relative_bound": "2**-63",
        "primitive_abs_ulp_bound": 2,
        "rows": rows,
    }


def _sweep_seed(shard_index):
    """Derive a stable 64-bit seed from the master seed and shard index."""
    return (
        SWEEP_MASTER_SEED
        + (shard_index + 1) * SWEEP_SEED_STEP
    ) & ((1 << 64) - 1)


def _sweep_row(function, input_raw):
    q64 = 1 << 64
    value = Decimal(input_raw) / Decimal(q64)
    reference = {
        "exp2": ref_exp2,
        "log2": ref_log2,
        "ln": ref_ln,
    }[function]
    return {
        "f": function,
        "in": input_raw,
        "out": raw_64x64_nearest(reference(value)),
    }


def _sweep_cost_row(q_l_raw, q_s_raw, b_raw):
    q64 = 1 << 64
    q_l = Decimal(q_l_raw) / Decimal(q64)
    q_s = Decimal(q_s_raw) / Decimal(q64)
    b = Decimal(b_raw) / Decimal(q64)
    return {
        "f": "cost",
        "q_l": q_l_raw,
        "q_s": q_s_raw,
        "b": b_raw,
        "out": raw_64x64_nearest(cost(b, q_l, q_s)),
    }


def _structured_sweep_inputs():
    """Edges repeated once in every shard (04 §4 dense/domain coverage)."""
    q64 = 1 << 64
    alternating_a = 0xAAAAAAAA_AAAAAAAA
    alternating_5 = 0x55555555_55555555
    return [
        ("exp2", q64 - 1),
        ("exp2", alternating_a),
        ("exp2", alternating_5),
        ("exp2", 0xFFFFFFFF_00000000),
        ("exp2", 0x00000000_FFFFFFFF),
        ("exp2", 0xF0F0F0F0_F0F0F0F0),
        ("exp2", (63 << 64) | (q64 - 1)),
        ("exp2", (63 << 64) | alternating_a),
        ("exp2", (63 << 64) | alternating_5),
        ("log2", 1 << 64),
        ("log2", 1 << 127),
        ("log2", (1 << 128) - 1),
        ("ln", 1 << 64),
        ("ln", 1 << 127),
        ("ln", (1 << 128) - 1),
        ("cost", 0, 0, 1 << 64),
        ("cost", 1 << 64, 0, 1 << 64),
        ("cost", 48 << 64, 0, 1 << 64),
        ("cost", 0, 48 << 64, 1 << 64),
        ("cost", 1_048_000_000 << 64, 1_000_000_000 << 64, 1_000_000 << 64),
    ]


def _random_cost_row(rng):
    """Sample an LMSR state over realistic b magnitudes and the full domain."""
    q64 = 1 << 64
    decade = rng.getrandbits(4) % 9
    lower = 10**decade
    b_units = lower + (rng.getrandbits(32) % (9 * lower))
    b_raw = b_units << 64
    common_ratio_raw = rng.getrandbits(71) % (101 * q64)
    domain_ratio_raw = rng.getrandbits(70) % (48 * q64 + 1)
    common = b_raw * common_ratio_raw // q64
    difference = b_raw * domain_ratio_raw // q64
    if rng.getrandbits(1):
        q_l_raw, q_s_raw = common + difference, common
    else:
        q_l_raw, q_s_raw = common, common + difference
    return _sweep_cost_row(q_l_raw, q_s_raw, b_raw)


def _generate_sweep_shard(task):
    """Generate one shard; safe to call in a multiprocessing worker."""
    shard_index, rows, output_dir = task
    # Decimal contexts are process-local. Keep input conversion at the same
    # 100-digit precision as the function-local reference oracle contexts.
    getcontext().prec = WORK_PREC
    rng = random.Random(_sweep_seed(shard_index))
    structured = _structured_sweep_inputs()
    if rows < len(structured):
        raise ValueError(
            f"shard {shard_index} has {rows} rows; "
            f"at least {len(structured)} are required for structured edges"
        )

    random_rows = rows - len(structured)
    counts = {
        "exp2_frac": random_rows * 55 // 100,
        "exp2_wide": random_rows * 15 // 100,
        "log2": random_rows * 10 // 100,
        "ln": random_rows * 10 // 100,
    }
    counts["cost"] = random_rows - sum(counts.values())

    def generated_rows():
        for row in structured:
            if row[0] == "cost":
                yield _sweep_cost_row(*row[1:])
            else:
                yield _sweep_row(*row)
        for _ in range(counts["exp2_frac"]):
            yield _sweep_row("exp2", rng.getrandbits(64))
        for _ in range(counts["exp2_wide"]):
            whole = 1 + (rng.getrandbits(8) % 63)
            yield _sweep_row(
                "exp2", (whole << 64) | rng.getrandbits(64)
            )
        for function in ("log2", "ln"):
            for _ in range(counts[function]):
                bits = 65 + (rng.getrandbits(8) % 64)
                input_raw = (1 << (bits - 1)) | rng.getrandbits(bits - 1)
                yield _sweep_row(function, input_raw)
        for _ in range(counts["cost"]):
            yield _random_cost_row(rng)

    relative_path = f"shards/sweep-{shard_index:03d}.json"
    shard_path = Path(output_dir) / relative_path
    temporary_path = shard_path.with_suffix(".json.tmp")
    digest = hashlib.sha256()

    def write_bytes(handle, data):
        handle.write(data)
        digest.update(data)

    with temporary_path.open("wb") as handle:
        header = (
            f'{{"schema":"{SWEEP_SCHEMA}","shard":{shard_index},'
            '"rows":[\n'
        ).encode("ascii")
        write_bytes(handle, header)
        for row_index, row in enumerate(generated_rows()):
            line = json.dumps(
                row, separators=(",", ":"), ensure_ascii=True
            ).encode("ascii")
            if row_index + 1 != rows:
                line += b","
            write_bytes(handle, line + b"\n")
        write_bytes(handle, b"]}\n")
    temporary_path.replace(shard_path)
    return {
        "file": relative_path,
        "rows": rows,
        "sha256": digest.hexdigest(),
    }


def generate_sweep(output_dir, points, shards, workers):
    """Emit the deterministic, content-addressed release sweep corpus."""
    if points < 1:
        raise ValueError("--sweep-points must be positive")
    if shards < 1:
        raise ValueError("--sweep-shards must be positive")
    if workers < 1:
        raise ValueError("--sweep-workers must be positive")
    if points < shards * SWEEP_STRUCTURED_ROWS:
        raise ValueError(
            f"--sweep-points must allow all {SWEEP_STRUCTURED_ROWS} structured edges in every shard"
        )

    output_dir = Path(output_dir)
    shard_dir = output_dir / "shards"
    shard_dir.mkdir(parents=True, exist_ok=True)
    base_rows, extra_rows = divmod(points, shards)
    tasks = [
        (
            shard_index,
            base_rows + (1 if shard_index < extra_rows else 0),
            str(output_dir),
        )
        for shard_index in range(shards)
    ]
    expected_shards = {
        f"sweep-{shard_index:03d}.json" for shard_index in range(shards)
    }
    stale_shards = sorted(
        path.name
        for path in shard_dir.glob("sweep-*")
        if path.name not in expected_shards
    )
    if stale_shards:
        raise ValueError(
            "sweep output contains stale shard files: "
            + ", ".join(stale_shards)
        )
    process_count = min(workers, shards)
    with multiprocessing.Pool(processes=process_count) as pool:
        shard_entries = pool.map(_generate_sweep_shard, tasks)

    manifest = {
        "schema": SWEEP_SCHEMA,
        "kind": "transcendental-sweep",
        "seed": f"0x{SWEEP_MASTER_SEED:016X}",
        "points": points,
        "generator": "tools/reference-model/generate-vectors.py",
        "exp2_relative_bound": "2**-63",
        "primitive_abs_ulp_bound": 2,
        "composed_cost_abs_ulp_bound": 8,
        "distribution": {
            "random_rows": {
                "exp2_frac": "55%",
                "exp2_wide": "15%",
                "log2": "10%",
                "ln": "10%",
                "cost": "10% (including integer remainder)",
            },
            "structured_rows_per_shard": SWEEP_STRUCTURED_ROWS,
            "structured_edges": (
                "all-ones/alternating fractions, top-octave values, and LMSR domain edges"
            ),
            "shard_seed": (
                "(master + (shard + 1) * 0x9E3779B97F4A7C15) mod 2**64"
            ),
        },
        "shards": shard_entries,
    }
    manifest_path = output_dir / "sweep-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )


def build():
    samples = []
    for ql, qs in [
        (0, 0),
        (1000, 0),
        (2500, 0),
        (0, 2500),
        (12345, 6789),
        (6789, 12345),
        (240000, 0),
        (0, 240000),
        (480000, 0),
    ]:
        c = cost(10000, ql, qs)
        p = marginal_price_long(10000, ql, qs)
        samples.append(
            {
                "q_long": str(ql),
                "q_short": str(qs),
                "cost": fmt(c),
                "cost_raw_64x64_nearest": raw_64x64_nearest(c),
                "price_long": fmt(p),
                "price_raw_64x64_nearest": raw_64x64_nearest(p),
            }
        )

    pipeline = full_pipeline(**_decimal_tree(WELFARE_INPUTS))
    non_binary_pipeline = full_pipeline(
        **_decimal_tree(WELFARE_NON_BINARY_DAILY_WEIGHTS_INPUTS)
    )
    # 07 §10 settlement-time recompute: a component flagged in two consecutive
    # epochs meeting inside the cohort's W_{e+1}/W_{e+2} window is dropped from
    # both recomputes, surviving weights renormalized within the pillar group
    # (the Q64.64 quotient of 05 §4.4 / SQ-321). Both drop sets name only
    # attested components — C03 is the attested C member, A01/A02 are the
    # attested A members — because only class-4 components can be flagged
    # (07 §11(1)(i)).
    dropped_components = ["A01", "C03"]
    dropped_pipeline = full_pipeline_renormalized(
        dropped=dropped_components, **_decimal_tree(WELFARE_INPUTS)
    )
    # Dropping every A component empties the pillar: 05 §4.1's {wP, wA} then
    # renormalizes over the survivor, so the composite is P alone at weight
    # exactly 1 — and by §4.4's degenerate-single-term exactness rule (SQ-493)
    # that composite *is* P, bit-exactly, not the exp2(log2(P)) round-trip one
    # ulp below it. The reported A is the empty weighted product on the FixedU64
    # grid, 1.000000000: inert, because §4.4 rule 2 drops the composite term
    # outright rather than multiplying by it ("never on a fabricated A = 1"), so
    # its weight is exactly 0. It must not be read as "the A pillar is perfect",
    # and W here is not GeoComposite(P, 1.0) — that value is strictly higher.
    dropped_a_pillar = ["A01", "A02"]
    dropped_a_pipeline = full_pipeline_renormalized(
        dropped=dropped_a_pillar, **_decimal_tree(WELFARE_INPUTS)
    )
    # The same emptied-A drop at live gates (g(S) = 1), where the composite leg
    # reaches `W` instead of being zeroed by the S gate. The pair of rows below
    # differs in the drop alone, so `W` isolates it: 05 §4.4 rule 2's
    # `W = g(S)·g(C)·P` against the two-term GeoComposite of the same tree.
    live_gates_pipeline = full_pipeline(
        **_decimal_tree(WELFARE_LIVE_GATES_INPUTS)
    )
    live_gates_dropped_a_pipeline = full_pipeline_renormalized(
        dropped=dropped_a_pillar, **_decimal_tree(WELFARE_LIVE_GATES_INPUTS)
    )
    welfare_scenarios = [
        {
            "name": "equal_horizons",
            "inputs": {"w_next": "0.8", "w_next_2": "0.8"},
            "s": format(
                settlement_score(Decimal("0.8"), Decimal("0.8")), "f"
            ),
        },
        {
            "name": "mixed_horizons",
            "inputs": {"w_next": "0.64", "w_next_2": "0.25"},
            "s": format(
                settlement_score(Decimal("0.64"), Decimal("0.25")), "f"
            ),
        },
        {
            "name": "full_pipeline",
            "inputs": WELFARE_INPUTS,
            "outputs": _string_tree(pipeline),
            "settlement_with_self": format(
                settlement_score(pipeline["W"], pipeline["W"]), "f"
            ),
        },
        {
            "name": "full_pipeline_non_binary_daily_weights",
            "inputs": WELFARE_NON_BINARY_DAILY_WEIGHTS_INPUTS,
            "outputs": _string_tree(non_binary_pipeline),
            "settlement_with_self": format(
                settlement_score(
                    non_binary_pipeline["W"], non_binary_pipeline["W"]
                ),
                "f",
            ),
        },
        {
            "name": "settlement_renormalized_drops_flagged_components",
            "inputs": WELFARE_INPUTS,
            "dropped": dropped_components,
            "outputs": _string_tree(dropped_pipeline),
            "settlement_with_self": format(
                settlement_score(
                    dropped_pipeline["W"], dropped_pipeline["W"]
                ),
                "f",
            ),
        },
        {
            "name": "settlement_renormalized_drops_whole_a_pillar",
            "inputs": WELFARE_INPUTS,
            "dropped": dropped_a_pillar,
            "outputs": _string_tree(dropped_a_pipeline),
            "settlement_with_self": format(
                settlement_score(
                    dropped_a_pipeline["W"], dropped_a_pipeline["W"]
                ),
                "f",
            ),
        },
        # The un-dropped half of the live-gate pair: an ordinary §4.4 pipeline
        # row (no `dropped` key), so the recompute row below is a controlled
        # A/B against it — same inputs, same S/C/P, `W` differing in the drop.
        {
            "name": "full_pipeline_live_gates",
            "inputs": WELFARE_LIVE_GATES_INPUTS,
            "outputs": _string_tree(live_gates_pipeline),
            "settlement_with_self": format(
                settlement_score(
                    live_gates_pipeline["W"], live_gates_pipeline["W"]
                ),
                "f",
            ),
        },
        {
            "name": "settlement_renormalized_whole_a_pillar_at_live_gates",
            "inputs": WELFARE_LIVE_GATES_INPUTS,
            "dropped": dropped_a_pillar,
            "outputs": _string_tree(live_gates_dropped_a_pipeline),
            "settlement_with_self": format(
                settlement_score(
                    live_gates_dropped_a_pipeline["W"],
                    live_gates_dropped_a_pipeline["W"],
                ),
                "f",
            ),
        },
    ]

    backward = TwapAccumulator(Decimal("0.500"))
    first = backward.observe(10, Decimal("0.900"))
    second = backward.observe(20, Decimal("0.900"))
    stale = TwapAccumulator(Decimal("0.500"))
    stale_recorded = stale.observe(60, Decimal("0.900"))
    twap_scenarios = [
        {
            "name": "backward_weighted_mean",
            "inputs": {
                "initial": "0.500",
                "observations": [
                    {"block": 10, "previous_quote": "0.900"},
                    {"block": 20, "previous_quote": "0.900"},
                ],
            },
            "recorded": [format(first, "f"), format(second, "f")],
            "mean_0_20": format(backward.mean(0, 20), "f"),
            "mean_10_20": format(backward.mean(10, 20), "f"),
            "stale_events": backward.stale_events,
        },
        {
            "name": "stale_gap_accounting",
            "inputs": {"block": 60, "previous_quote": "0.900"},
            "recorded": format(stale_recorded, "f"),
            "stale_events": stale.stale_events,
        },
    ]

    window_stale_scenarios = [
        _window_stale_row(*scenario) for scenario in WINDOW_STALE_SCENARIOS
    ]

    return {
        "schema": "bleavit.reference-model.v4",
        "precision": "Python Decimal with function-local 100-digit working contexts",
        "lmsr_vectors": vectors_v1_v6(),
        "lmsr_maker_example": _string_tree(worked_maker_example()),
        "high_precision_corpus": {"b": "10000", "samples": samples},
        "transcendental_corpus": _transcendental_corpus(),
        "ledger_scenarios": _ledger_scenarios(),
        "ledger_fee_scenarios": _ledger_fee_scenarios(),
        "ledger_sequence_scenarios": _ledger_sequence_scenarios(),
        "ledger_score_scenarios": _ledger_score_scenarios(),
        "ledger_sweep_scenarios": _ledger_sweep_scenarios(),
        "ledger_error_scenarios": _ledger_error_scenarios(),
        "decision_scenarios": [
            _decision_row(scenario) for scenario in DECISION_SCENARIOS
        ],
        "welfare_scenarios": welfare_scenarios,
        "welfare_normalization_scenarios": [
            _normalization_row(scenario) for scenario in NORMALIZATION_SCENARIOS
        ],
        "treasury_scenarios": _treasury_scenarios(),
        "twap_scenarios": twap_scenarios,
        "window_stale_scenarios": window_stale_scenarios,
        "contest_scenarios": _contest_scenarios(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--out", default="reference-model/fixtures/vectors.json"
    )
    parser.add_argument("--sweep-out")
    parser.add_argument("--sweep-points", type=int)
    parser.add_argument("--sweep-shards", type=int)
    parser.add_argument("--sweep-workers", type=int)
    args = parser.parse_args()
    if args.sweep_out is not None:
        if args.check or args.out != "reference-model/fixtures/vectors.json":
            parser.error("--sweep-out cannot be combined with --check or --out")
        try:
            generate_sweep(
                args.sweep_out,
                (
                    args.sweep_points
                    if args.sweep_points is not None
                    else 10_000_000
                ),
                (
                    args.sweep_shards
                    if args.sweep_shards is not None
                    else 100
                ),
                (
                    args.sweep_workers
                    if args.sweep_workers is not None
                    else os.cpu_count() or 1
                ),
            )
        except ValueError as error:
            parser.error(str(error))
        return
    if any(
        option is not None
        for option in (
            args.sweep_points,
            args.sweep_shards,
            args.sweep_workers,
        )
    ):
        parser.error("sweep-only options require --sweep-out")
    text = json.dumps(build(), sort_keys=True, indent=2) + "\n"
    path = Path(args.out)
    if args.check:
        if not path.exists() or path.read_text() != text:
            raise SystemExit(
                f"{path} is stale; run tools/reference-model/generate-vectors.py"
            )
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


if __name__ == "__main__":
    main()
