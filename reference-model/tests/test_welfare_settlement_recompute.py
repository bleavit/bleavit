"""07 §10 settlement-time `W` recompute (SQ-493).

"Two consecutive flagged epochs ⇒ affected not-yet-settled cohorts recompute `W`
without the component, weights renormalized" (07 §10). The arithmetic is derived
here from 05 §4.1/§4.4 and 07 §10/§11(1) alone — the expected pillar values are
hand-built from the spec's own formulas (Q64.64 renormalization quotient,
floored 64.64 weighted-log products, immediate 1e-9 floors), never read back out
of the function under test.
"""

from __future__ import annotations

import json
import unittest
from decimal import Decimal, ROUND_FLOOR, localcontext
from pathlib import Path

from bleavit_reference_model.welfare import (
    EPSILON_C,
    EPSILON_P,
    LN2,
    THETA_C_HI,
    THETA_C_LO,
    THETA_S_HI,
    THETA_S_LO,
    WEIGHT_A,
    WEIGHT_P,
    WORK_PREC,
    drop_and_renormalize,
    emptied_pillar_groups,
    floor_fixed,
    full_pipeline,
    full_pipeline_renormalized,
    gate,
    geo_composite,
    settlement_score,
)

Q64 = Decimal(1 << 64)
GRID = Decimal("1e-9")

# The generator's shared welfare input tree (04 §5 corpus row inputs). C03 is the
# attested C member and A01/A02 are the attested A members, so they are the only
# components that 07 §11(1)(i) lets the oracle flag at all.
INPUTS = {
    "u": Decimal("0.97"),
    "f": Decimal("0.96"),
    "hhi": Decimal("0.335"),
    "phase": 2,
    "c_onchain": {"C01": Decimal("0.94"), "C02": Decimal("0.91")},
    "c_attested": {"C03": Decimal("0.90")},
    "c_weights": {
        "C01": Decimal("0.50"),
        "C02": Decimal("0.30"),
        "C03": Decimal("0.20"),
    },
    "incident": Decimal("0.98"),
    "p_components": {"P01": Decimal("0.80"), "P02": Decimal("0.70")},
    "p_weights": {"P01": Decimal("0.60"), "P02": Decimal("0.40")},
    "a_components": {"A01": Decimal("0.90"), "A02": Decimal("0.60")},
    "a_weights": {"A01": Decimal("0.40"), "A02": Decimal("0.60")},
    "c_daily": {"C01": Decimal("0.93"), "C02": Decimal("0.89")},
}

# Same components, but S high enough that g(S) = 1 (S = 0.99 ≥ θS⁺ = 0.98), so
# `W` is not gate-vetoed to zero and the composite leg is observable.
LIVE_S_INPUTS = {
    **INPUTS,
    "u": Decimal("0.99"),
    "f": Decimal("0.99"),
    "hhi": Decimal("0.10"),
}


def _q64_raw(value: Decimal) -> int:
    """`Q64(x) = floor(x · 2^64 / 10^9)` of 05 §4.4 over a FixedU64 value."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        grid = value.quantize(GRID, rounding=ROUND_FLOOR)
        return int((grid * Q64).to_integral_value(rounding=ROUND_FLOOR))


def _renormalized_weight(weight: Decimal, total: Decimal) -> Decimal:
    """`w̃_j = floor_Q64(Q64(w_j) / Q64(T))` — SQ-321's normative quotient."""
    return Decimal((_q64_raw(weight) << 64) // _q64_raw(total)) / Q64


def _weighted_geometric(pairs, epsilon: Decimal) -> Decimal:
    """05 §4.4(2): exp2(Σ floor_64x64(w·log2(max(x, ε)))), ascending MetricId.

    Plus §4.4's degenerate-single-term exactness rule (SQ-493): one
    participating term at weight exactly 1 evaluates to that term's value, not
    through the round-trip, which would floor one ulp short of an on-grid value.
    """
    participating = [pair for pair in pairs if pair[2] > 0]
    if len(participating) == 1 and participating[0][2] == 1:
        return floor_fixed(max(participating[0][1], epsilon))
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        exponent = Decimal(0)
        for _, value, weight in sorted(pairs):
            term = weight * (max(value, epsilon).ln() / LN2)
            exponent += Decimal(
                (term * Q64).to_integral_value(rounding=ROUND_FLOOR)
            ) / Q64
        return floor_fixed((exponent * LN2).exp())


class SettlementRecomputeTests(unittest.TestCase):
    def test_dropping_nothing_is_the_unchanged_pipeline(self):
        baseline = full_pipeline(**INPUTS)
        for dropped in (None, [], (), frozenset(), set()):
            with self.subTest(dropped=dropped):
                self.assertEqual(full_pipeline(dropped=dropped, **INPUTS), baseline)
        # The named recompute entry point refuses a no-op: an empty drop set is
        # not a 07 §10 recompute, it is the ordinary §4.4 pipeline.
        with self.assertRaises(ValueError):
            full_pipeline_renormalized(dropped=[], **INPUTS)

    def test_dropping_one_attested_c_component_renormalizes_the_joint_group(self):
        # Survivors C01 (w 0.50) and C02 (w 0.30); T = 0.80, so the Q64 quotients
        # are 0.625 and (just under) 0.375. `I` stays a pure multiplier.
        total = Decimal("0.80")
        c_geo = _weighted_geometric(
            [
                ("C01", Decimal("0.94"), _renormalized_weight(Decimal("0.50"), total)),
                ("C02", Decimal("0.91"), _renormalized_weight(Decimal("0.30"), total)),
            ],
            EPSILON_C,
        )
        expected_c = floor_fixed(floor_fixed(Decimal("0.98")) * c_geo)
        self.assertEqual(expected_c, Decimal("0.910063100"))

        row = full_pipeline_renormalized(dropped=["C03"], **INPUTS)
        self.assertEqual(row["C"], expected_c)
        # Dropping the weakest C member raises C — the drop is not a penalty.
        self.assertGreater(row["C"], full_pipeline(**INPUTS)["C"])
        # The joint-C drop touches nothing else.
        for key in ("S", "P", "A", "S_daily", "C_daily", "D_eff"):
            self.assertEqual(row[key], full_pipeline(**INPUTS)[key])

    def test_partial_a_drop_renormalizes_the_survivor_to_weight_one(self):
        survivor_weight = _renormalized_weight(Decimal("0.60"), Decimal("0.60"))
        self.assertEqual(survivor_weight, Decimal(1))
        expected_a = _weighted_geometric(
            [("A02", Decimal("0.60"), survivor_weight)], EPSILON_P
        )
        # §4.4's exactness rule: the single survivor at weight exactly 1 IS the
        # pillar. Evaluating exp2(log2(0.60)) with the mandated 64.64 product
        # floor would report 0.599999999 — one ulp short of an on-grid value.
        self.assertEqual(expected_a, Decimal("0.600000000"))
        self.assertEqual(
            full_pipeline_renormalized(dropped=["A01"], **INPUTS)["A"], expected_a
        )
        # Same rule inside the joint C group: one survivor renormalizes to
        # weight 1, so C is exactly I · c_survivor on the grid.
        self.assertEqual(
            full_pipeline_renormalized(dropped=["C02", "C03"], **INPUTS)["C"],
            floor_fixed(Decimal("0.98") * Decimal("0.94")),
        )

    def test_whole_a_pillar_drop_leaves_the_composite_as_p_alone(self):
        baseline = full_pipeline(**LIVE_S_INPUTS)
        row = full_pipeline_renormalized(dropped=["A01", "A02"], **LIVE_S_INPUTS)
        self.assertEqual(row["S"], Decimal("0.990000000"))
        self.assertEqual(row["C"], baseline["C"])
        self.assertEqual(row["P"], baseline["P"])
        # The emptied pillar reports the empty weighted product on the grid.
        self.assertEqual(row["A"], Decimal("1.000000000"))

        # 05 §4.1's {wP, wA} renormalize over the survivor: P at weight exactly 1.
        composite = _weighted_geometric(
            [("P", row["P"], _renormalized_weight(WEIGHT_P, WEIGHT_P))], EPSILON_P
        )
        gs = gate(row["S"], THETA_S_LO, THETA_S_HI)
        gc = gate(row["C"], THETA_C_LO, THETA_C_HI)
        self.assertEqual(gs, Decimal(1))
        expected_w = floor_fixed(floor_fixed(gs * gc) * composite)
        self.assertEqual(row["W"], expected_w)
        self.assertGreater(row["W"], Decimal(0))
        # The inert A = 1.0 must not leak into the composite: a genuine
        # `GeoComposite(P, 1.0)` would score strictly higher than P alone.
        naive = floor_fixed(
            floor_fixed(gs * gc) * geo_composite(row["P"], Decimal(1))
        )
        self.assertLess(row["W"], naive)
        # ...and the surviving pillar carries the composite bit-exactly: §4.4's
        # exactness rule forbids the exp2(log2(P)) round-trip, which would land
        # one 1e-9 ulp under P and drag W with it.
        self.assertEqual(composite, floor_fixed(row["P"]))
        self.assertEqual(
            geo_composite(row["P"], row["A"], emptied_pillars={"A"}),
            floor_fixed(row["P"]),
        )

    def test_emptying_the_joint_c_group_declines_the_drop(self):
        baseline = full_pipeline(**INPUTS)
        # Not reachable for a v1-conforming spec set (no gate-bearing C member is
        # attested, 07 §2/§10), but the decline is what keeps an unmeasurable C
        # from scoring 1.0 through the empty-product identity.
        row = full_pipeline(dropped=["C01", "C02", "C03"], **INPUTS)
        self.assertEqual(row, baseline)
        self.assertEqual(
            drop_and_renormalize(
                INPUTS["c_onchain"] | INPUTS["c_attested"],
                INPUTS["c_weights"],
                ["C01", "C02", "C03"],
                EPSILON_C,
            ),
            drop_and_renormalize(
                INPUTS["c_onchain"] | INPUTS["c_attested"],
                INPUTS["c_weights"],
                None,
                EPSILON_C,
            ),
        )

    def test_emptying_s_or_both_composite_pillars_declines_the_drop(self):
        baseline = full_pipeline(**INPUTS)
        # S is a min: emptied it has nothing to renormalize away either.
        self.assertEqual(full_pipeline(dropped=["U", "F", "D_eff"], **INPUTS), baseline)
        # A partial S drop is honored — the min runs over the survivors.
        self.assertEqual(
            full_pipeline(dropped=["D_eff"], **INPUTS)["S"], Decimal("0.960000000")
        )
        # Both composite pillars emptied: no survivor can carry {wP, wA}.
        self.assertEqual(
            full_pipeline(dropped=["P01", "P02", "A01", "A02"], **INPUTS), baseline
        )
        self.assertEqual(
            emptied_pillar_groups(
                ["P01", "P02", "A01", "A02"],
                INPUTS["p_components"],
                INPUTS["a_components"],
            ),
            frozenset(),
        )
        self.assertEqual(
            emptied_pillar_groups(
                ["A01", "A02"], INPUTS["p_components"], INPUTS["a_components"]
            ),
            frozenset({"A"}),
        )

    def test_daily_values_are_not_recomputed_and_unknown_ids_fail_closed(self):
        baseline = full_pipeline(**INPUTS)
        # 05 §4.7/§4.2: the daily values settle the gate markets and no attested
        # value may move a gate flag, so 07 §10's settlement recompute leaves
        # them alone even when the drop set names an on-chain C member.
        row = full_pipeline(dropped=["C01"], **INPUTS)
        self.assertEqual(row["C_daily"], baseline["C_daily"])
        self.assertEqual(row["S_daily"], baseline["S_daily"])
        self.assertNotEqual(row["C"], baseline["C"])
        # A drop set naming something outside the MetricSpec is a defect, not a
        # silent no-op that would hide a missing recompute in a differential run.
        for unknown in (["C99"], ["A01", "nope"], ["P01 "]):
            with self.subTest(unknown=unknown):
                with self.assertRaises(ValueError):
                    full_pipeline(dropped=unknown, **INPUTS)

    def test_corpus_rows_replay_from_the_model(self):
        corpus = json.loads(
            (
                Path(__file__).resolve().parents[1] / "fixtures" / "vectors.json"
            ).read_text()
        )
        rows = {
            row["name"]: row
            for row in corpus["welfare_scenarios"]
            if "outputs" in row
        }
        # Every 07 §10 recompute row, and the two ordinary pipeline rows they are
        # controlled against (`full_pipeline_live_gates` is the un-dropped half of
        # the live-gate A/B pair).
        self.assertEqual(
            {name for name, row in rows.items() if "dropped" in row},
            {
                "settlement_renormalized_drops_flagged_components",
                "settlement_renormalized_drops_whole_a_pillar",
                "settlement_renormalized_whole_a_pillar_at_live_gates",
            },
        )
        self.assertIn("full_pipeline_live_gates", rows)
        for name, row in rows.items():
            with self.subTest(row=name):
                dropped = row.get("dropped")
                if dropped is not None:
                    self.assertEqual(dropped, sorted(dropped))
                replay = full_pipeline(
                    dropped=dropped,
                    **{
                        key: (
                            value
                            if key == "phase"
                            else {
                                inner: Decimal(number)
                                for inner, number in value.items()
                            }
                            if isinstance(value, dict)
                            else Decimal(value)
                        )
                        for key, value in row["inputs"].items()
                    },
                )
                self.assertEqual(
                    {key: format(value, "f") for key, value in replay.items()},
                    row["outputs"],
                )
                self.assertEqual(
                    format(settlement_score(replay["W"], replay["W"]), "f"),
                    row["settlement_with_self"],
                )

        # The live-gate pair isolates the composite renormalization inside `W`:
        # identical S/C/P/dailies, and the recomputed row's W is g(S)·g(C)·P
        # (05 §4.4 rule 2) instead of the two-term GeoComposite.
        base = rows["full_pipeline_live_gates"]["outputs"]
        recomputed = rows[
            "settlement_renormalized_whole_a_pillar_at_live_gates"
        ]["outputs"]
        for key in ("S", "C", "P", "S_daily", "C_daily", "D_eff"):
            self.assertEqual(base[key], recomputed[key])
        self.assertNotEqual(base["A"], recomputed["A"])
        self.assertNotEqual(base["W"], recomputed["W"])
        self.assertGreater(Decimal(base["W"]), Decimal(0))
        gs = gate(Decimal(recomputed["S"]), THETA_S_LO, THETA_S_HI)
        gc = gate(Decimal(recomputed["C"]), THETA_C_LO, THETA_C_HI)
        self.assertEqual(gs, Decimal(1))
        self.assertEqual(
            recomputed["W"],
            format(
                floor_fixed(floor_fixed(gs * gc) * Decimal(recomputed["P"])),
                "f",
            ),
        )


if __name__ == "__main__":
    unittest.main()
