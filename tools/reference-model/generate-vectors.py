#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "reference-model" / "src")
)

from bleavit_reference_model.decision import Grade, decide
from bleavit_reference_model.ledger import (
    BaselineVault,
    Branch,
    GateSide,
    GateType,
    PositionKind,
    ScalarSide,
    Vault,
)
from bleavit_reference_model.lmsr import (
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
    decision_delta,
    display_integer,
    in_cap_prize,
    nav_floor,
    p_ref,
    pol_b,
    pol_commitment,
    security_sizing_ok,
)
from bleavit_reference_model.twap import TwapAccumulator
from bleavit_reference_model.welfare import full_pipeline, settlement_score

DECISION_SCENARIOS = [
    {"name": "adopt", "inputs": {}},
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
            "requires_gate_markets": True,
            "gate_book_valid": False,
        },
    },
    {
        "name": "gate_veto_survival",
        "inputs": {
            "requires_gate_markets": True,
            "p_adopt": {"Survival": "0.06"},
            "p_reject": {"Survival": "0.01"},
        },
    },
    {
        "name": "gate_veto_security",
        "inputs": {
            "requires_gate_markets": True,
            "p_adopt": {"Survival": "0.01", "Security": "0.06"},
            "p_reject": {"Survival": "0.01", "Security": "0.01"},
        },
    },
    {
        "name": "gate_veto_precedes_welfare_invalid",
        "inputs": {
            "requires_gate_markets": True,
            "p_adopt": {"Survival": "0.06"},
            "welfare_grade": "Invalid",
        },
    },
    {
        "name": "gate_veto_precedes_later_gate_invalid",
        "inputs": {
            "requires_gate_markets": True,
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
        "name": "attestation_missing",
        "inputs": {
            "proposal_class": "Code",
            "attestation_ok": False,
        },
    },
    {
        "name": "rate_limited",
        "inputs": {"queue_time_ok": False},
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


def _treasury_scenarios():
    rows = []
    for name, large in [
        ("Param", False),
        ("Treasury", False),
        ("Treasury", True),
        ("Code", False),
        ("Meta", False),
    ]:
        rows.append(
            {
                "name": f"{name.lower()}_pol"
                + ("_large" if large else ""),
                "inputs": {
                    "proposal_class": name,
                    "large_treasury": large,
                },
                "commitment": format(
                    pol_commitment(name, large_treasury=large), "f"
                ),
                "commitment_display": display_integer(
                    pol_commitment(name, large_treasury=large)
                ),
                "nav_floor": format(
                    nav_floor(name, large_treasury=large), "f"
                ),
                "nav_floor_display": display_integer(
                    nav_floor(name, large_treasury=large)
                ),
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

    return {
        "schema": "bleavit.reference-model.v3",
        "precision": "Python Decimal with function-local 100-digit working contexts",
        "lmsr_vectors": vectors_v1_v6(),
        "lmsr_maker_example": _string_tree(worked_maker_example()),
        "high_precision_corpus": {"b": "10000", "samples": samples},
        "transcendental_corpus": _transcendental_corpus(),
        "ledger_scenarios": _ledger_scenarios(),
        "decision_scenarios": [
            _decision_row(scenario) for scenario in DECISION_SCENARIOS
        ],
        "welfare_scenarios": welfare_scenarios,
        "treasury_scenarios": _treasury_scenarios(),
        "twap_scenarios": twap_scenarios,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--out", default="reference-model/fixtures/vectors.json"
    )
    args = parser.parse_args()
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
