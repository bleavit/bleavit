"""Pins TH-72's derived attack cost and the N14 equalization (16 §8.4; 08 §7).

Follows the S6–S11 convention in two ways that matter. Every published figure is
pinned so a spec table and this model cannot drift apart silently; and the
*superseded* or *naive* routes to each figure are asserted **not** to reproduce
it, because a suite that only asserts right answers cannot catch a known error
coming back. Three such guards are here: the un-normalized comparison, the
`b`-versus-`b·ln 2` conflation, and benchmarking against the wrong channel.
"""

from __future__ import annotations

import unittest
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model import slot_pricing as sp
from bleavit_reference_model import threat_costs

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = REPO_ROOT / "simulation/results/phase0-calibration.json"


def _round(value: Decimal, places: str = "1") -> Decimal:
    return value.quantize(Decimal(places))


class AttackerCostTests(unittest.TestCase):
    """TH-72's missing cell, derived."""

    def test_per_class_cost_per_epoch(self) -> None:
        expected = {
            "param": Decimal(792),
            "treasury": Decimal(1390),
            "code": Decimal(2786),
            "meta": Decimal(4381),
        }
        for cls, want in expected.items():
            with self.subTest(cls=cls):
                self.assertEqual(_round(sp.attacker_cost_per_epoch(cls).total), want)

    def test_service_fee_is_the_kernel_floor_for_every_class(self) -> None:
        """Finding 1: the fee leg is flat, so it is identical across classes."""
        fees = {sp.attacker_cost_per_epoch(c).service_fee for c in sp.POL_B_DECISION}
        self.assertEqual(fees, {sp.SVC_FEE_FLOOR_USDC})

    def test_param_is_the_cheapest_class_to_deny(self) -> None:
        """The structural finding: protection scales with subsidy, so the
        least-subsidized class is the most purchasable."""
        costs = {c: sp.attacker_cost_per_epoch(c).total for c in sp.POL_B_DECISION}
        self.assertEqual(min(costs, key=lambda c: costs[c]), "param")
        self.assertEqual(max(costs, key=lambda c: costs[c]), "meta")

    def test_cost_ordering_follows_pol_b_ordering(self) -> None:
        by_pol_b = sorted(sp.POL_B_DECISION, key=lambda c: sp.POL_B_DECISION[c])
        by_cost = sorted(
            sp.POL_B_DECISION, key=lambda c: sp.attacker_cost_per_epoch(c).total
        )
        self.assertEqual(by_pol_b, by_cost)

    def test_unknown_class_refuses_rather_than_guesses(self) -> None:
        with self.assertRaises(sp.SlotPricingError):
            sp.attacker_cost_per_epoch("gate")


class DepthIsUnpricedTests(unittest.TestCase):
    """Finding 1 — the defect N14 exists to repair."""

    def test_fee_does_not_move_with_posted_depth(self) -> None:
        finding = sp.check_depth_is_unpriced()
        self.assertTrue(finding["fee_is_independent_of_posted_depth"])
        self.assertEqual(finding["fee_at_minimum_stake"], Decimal(393))

    def test_minimum_stake_fee_is_the_floor_not_the_rate_leg(self) -> None:
        """At one base unit the rate leg is ~1e-7 USDC, so the floor must bind.

        If a future edit lets the rate leg win here, the fee would collapse to
        dust and the finding would silently get worse rather than better.
        """
        self.assertEqual(sp.fee_at_minimum_declared_stake(), sp.SVC_FEE_FLOOR_USDC)
        self.assertGreater(sp.SVC_FEE_FLOOR_USDC, Decimal("0.10") * Decimal("0.000001"))

    def test_a_hundredfold_fee_rate_still_does_not_reach_the_floor(self) -> None:
        self.assertEqual(
            sp.fee_at_minimum_declared_stake(Decimal(10)), sp.SVC_FEE_FLOOR_USDC
        )


class EqualizationTests(unittest.TestCase):
    """The hosted door against the cheapest door that is already priced."""

    def test_benchmark_is_intake_denial_at_6400(self) -> None:
        name, cost = sp.cheapest_priced_denial_channel()
        self.assertEqual(name, "intake_denial")
        self.assertEqual(cost, Decimal(6400))

    def test_benchmark_is_the_minimum_not_the_mean(self) -> None:
        """Pricing against an average would leave the cheap route open."""
        every = [
            Decimal(threat_costs.intake_monopolization_cost(s).cost_per_epoch.numerator)
            / Decimal(threat_costs.intake_monopolization_cost(s).cost_per_epoch.denominator)
            for s in ("intake_denial", "slot_capture", "combined", "refund_path")
        ]
        _, benchmark = sp.cheapest_priced_denial_channel()
        self.assertEqual(benchmark, min(every))
        self.assertLess(benchmark, sum(every) / len(every))

    def test_hosted_door_is_cheaper_on_every_class(self) -> None:
        for cls, ratio in sp.equalization(ARTIFACT).items():
            with self.subTest(cls=cls):
                self.assertGreater(ratio, Decimal(1))

    def test_harm_normalized_ratios(self) -> None:
        expected = {
            "param": Decimal("3.16"),
            "treasury": Decimal("2.79"),
            "code": Decimal("1.63"),
            "meta": Decimal("1.23"),
        }
        got = sp.equalization(ARTIFACT)
        for cls, want in expected.items():
            with self.subTest(cls=cls):
                self.assertEqual(got[cls].quantize(Decimal("0.01")), want)

    def test_required_uplift_per_epoch(self) -> None:
        expected = {
            "param": Decimal(1710),
            "treasury": Decimal(2487),
            "code": Decimal(1752),
            "meta": Decimal(1002),
        }
        got = sp.required_uplift(ARTIFACT)
        for cls, want in expected.items():
            with self.subTest(cls=cls):
                self.assertEqual(_round(got[cls]), want)

    def test_worst_ratio_and_worst_uplift_are_different_classes(self) -> None:
        """Both are true and they disagree, so neither alone describes the hole.

        PARAM is the cheapest door (worst ratio); TREASURY needs the largest
        absolute uplift. A repair sized on either one alone misses the other.
        """
        eq, up = sp.equalization(ARTIFACT), sp.required_uplift(ARTIFACT)
        self.assertEqual(max(eq, key=lambda c: eq[c]), "param")
        self.assertEqual(max(up, key=lambda c: up[c]), "treasury")


class NaiveRoutesMustNotReproduceTests(unittest.TestCase):
    """The guards. Each pins a wrong route as wrong, not merely absent."""

    def test_unnormalized_comparison_does_not_reproduce_the_ratios(self) -> None:
        """Comparing at equal nominal cost overstates the gap by roughly two.

        This is the confound the N12 control hit from the other side — comparing
        two populations that differ in a second variable. Asserting the raw
        ratios differ keeps the normalization from being quietly dropped.
        """
        _, benchmark = sp.cheapest_priced_denial_channel()
        normalized = sp.equalization(ARTIFACT)
        for cls in sp.POL_B_DECISION:
            with self.subTest(cls=cls):
                raw = benchmark / sp.attacker_cost_per_epoch(cls).total
                self.assertNotEqual(
                    raw.quantize(Decimal("0.01")),
                    normalized[cls].quantize(Decimal("0.01")),
                )
                self.assertGreater(raw, normalized[cls])

    def test_raw_param_ratio_is_the_overstated_eight_fold_figure(self) -> None:
        _, benchmark = sp.cheapest_priced_denial_channel()
        raw = benchmark / sp.attacker_cost_per_epoch("param").total
        self.assertEqual(raw.quantize(Decimal("0.01")), Decimal("8.08"))
        self.assertEqual(
            sp.equalization(ARTIFACT)["param"].quantize(Decimal("0.01")),
            Decimal("3.16"),
        )

    def test_depth_cash_uses_b_ln2_not_b(self) -> None:
        """The conflation that produced the superseded escrow figure in
        `service_economics.py`. `b·ln 2` is the cash; `b` is the LMSR parameter."""
        cash = sp.parity_depth_cash(sp.POL_B_DECISION["code"])
        naive = Decimal(sp.EPOCH_SLATE_SIZE) * Decimal(2) * sp.POL_B_DECISION["code"] * Decimal(2)
        self.assertNotEqual(_round(cash), _round(naive))
        self.assertLess(cash, naive)

    def test_slot_capture_benchmark_would_understate_the_hole(self) -> None:
        """Benchmarking the intuitive channel instead of the cheapest one."""
        slot = threat_costs.intake_monopolization_cost("slot_capture").cost_per_epoch
        slot_value = Decimal(slot.numerator) / Decimal(slot.denominator)
        _, benchmark = sp.cheapest_priced_denial_channel()
        self.assertGreater(slot_value, benchmark)


class ThreatRowTests(unittest.TestCase):
    def test_th72_cost_cell_carries_no_figure(self) -> None:
        finding = sp.check_th72_attack_cost_is_unpriced(REPO_ROOT)
        self.assertTrue(finding["row_found"])
        self.assertTrue(finding["cost_cell_has_no_figure"])
        self.assertFalse(finding["priced_in_threat_costs"])

    def test_threat_costs_still_prices_only_three_rows(self) -> None:
        """A tripwire: if TH-72 gains a priced model upstream, this module's
        reason for existing changes and the docstring must be re-read."""
        source = (
            REPO_ROOT / "reference-model/src/bleavit_reference_model/threat_costs.py"
        ).read_text(encoding="utf-8")
        priced = {m for m in ("TH-11", "TH-16", "TH-64") if m in source}
        self.assertEqual(priced, {"TH-11", "TH-16", "TH-64"})
        self.assertNotIn("TH-72", source)


class ArithmeticHygieneTests(unittest.TestCase):
    def test_module_does_not_mutate_global_decimal_context(self) -> None:
        before = getcontext().prec
        sp.equalization(ARTIFACT)
        sp.required_uplift(ARTIFACT)
        self.assertEqual(getcontext().prec, before)

    def test_capital_time_value_matches_08_section_7(self) -> None:
        """The opportunity-cost half is 08 §7's own helper, not a private copy."""
        cash = sp.parity_depth_cash(sp.POL_B_DECISION["code"])
        want = threat_costs.capital_time_value(Fraction(int(cash)))
        got = sp.attacker_cost_per_epoch("code").capital_time_value
        self.assertEqual(
            got.quantize(Decimal("0.0001")),
            (Decimal(want.numerator) / Decimal(want.denominator)).quantize(
                Decimal("0.0001")
            ),
        )

    def test_zero_and_negative_inputs_refuse(self) -> None:
        with self.assertRaises(sp.SlotPricingError):
            sp.parity_depth_cash(Decimal(0))
        with self.assertRaises(sp.SlotPricingError):
            sp.parity_depth_cash(Decimal(10_000), slate=0)
        with self.assertRaises(sp.SlotPricingError):
            sp.fee_at_minimum_declared_stake(Decimal(-1))


if __name__ == "__main__":
    unittest.main()
