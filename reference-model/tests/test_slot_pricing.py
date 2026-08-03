"""Pins what `slot_pricing` may claim, and what it withdrew (16 §8.4; 08 §7).

Follows the S6–S11 convention in two ways that matter. Every published figure is
pinned so a spec table and this model cannot drift apart silently; and the
*superseded* or *naive* routes to each figure are asserted **not** to reproduce
it, because a suite that only asserts right answers cannot catch a known error
coming back.

The withdrawal of 2026-08-03 is itself pinned. An adversarial review refuted the
published ratios and uplift targets, so this suite now asserts the module exposes
**neither**, and that the two helpers which did are gone rather than merely
unused. The branch double-count that started it gets its own guard: the original
arithmetic guard pinned `b` versus `b·ln 2` and the error walked straight past
it, which is the argument for pinning structure and not only magnitude.
"""

from __future__ import annotations

import unittest
from decimal import Decimal, getcontext
from pathlib import Path

from bleavit_reference_model import slot_pricing as sp

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = REPO_ROOT / "simulation/results/phase0-calibration.json"


def _round(value: Decimal, places: str = "1") -> Decimal:
    return value.quantize(Decimal(places))


class AttackerCostTests(unittest.TestCase):
    """TH-72's missing cell, derived."""

    def test_per_class_carrying_cost_per_epoch(self) -> None:
        """Carrying cost only. NOT the attack cost — the maker-loss term is absent."""
        expected = {
            "param": Decimal(592),
            "treasury": Decimal(891),
            "code": Decimal(1589),
            "meta": Decimal(2387),
        }
        for cls, want in expected.items():
            with self.subTest(cls=cls):
                self.assertEqual(_round(sp.carrying_cost_per_epoch(cls).total), want)

    def test_service_fee_is_the_kernel_floor_for_every_class(self) -> None:
        """Finding 1: the fee leg is flat, so it is identical across classes."""
        fees = {sp.carrying_cost_per_epoch(c).service_fee for c in sp.POL_B_DECISION}
        self.assertEqual(fees, {sp.SVC_FEE_FLOOR_USDC})

    def test_param_is_the_cheapest_class_to_deny(self) -> None:
        """The structural finding: protection scales with subsidy, so the
        least-subsidized class is the most purchasable."""
        costs = {c: sp.carrying_cost_per_epoch(c).total for c in sp.POL_B_DECISION}
        self.assertEqual(min(costs, key=lambda c: costs[c]), "param")
        self.assertEqual(max(costs, key=lambda c: costs[c]), "meta")

    def test_cost_ordering_follows_pol_b_ordering(self) -> None:
        by_pol_b = sorted(sp.POL_B_DECISION, key=lambda c: sp.POL_B_DECISION[c])
        by_cost = sorted(
            sp.POL_B_DECISION, key=lambda c: sp.carrying_cost_per_epoch(c).total
        )
        self.assertEqual(by_pol_b, by_cost)

    def test_unknown_class_refuses_rather_than_guesses(self) -> None:
        with self.assertRaises(sp.SlotPricingError):
            sp.carrying_cost_per_epoch("gate")


class DepthIsUnpricedTests(unittest.TestCase):
    """The fee leg only. The capital leg is in RefutedClaimsTests."""

    def test_fee_does_not_move_with_posted_depth(self) -> None:
        finding = sp.check_fee_is_flat_in_depth()
        self.assertFalse(finding["fee_scales_with_depth"])
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


class RefutedClaimsTests(unittest.TestCase):
    """Each refuted claim pinned as refuted, so it cannot quietly return."""

    def test_fee_is_flat_in_depth_but_capital_is_not(self) -> None:
        """The narrowed survivor of 'a flat 393 USDC buys arbitrary depth'."""
        f = sp.check_fee_is_flat_in_depth()
        self.assertFalse(f["fee_scales_with_depth"])
        self.assertTrue(f["capital_scales_with_depth"])
        self.assertEqual(f["fee_at_minimum_stake"], Decimal(393))

    def test_depth_is_bounded_by_the_tvl_cap(self) -> None:
        """The bound that refuted 'arbitrary'. escrow = 2*b*ln2 <= cap."""
        b = sp.max_depth_under_tvl_cap()
        self.assertEqual(b.quantize(Decimal("1")), Decimal(1_442_695))
        escrow = Decimal(2) * b * Decimal(2).ln()
        self.assertEqual(
            escrow.quantize(Decimal("1")), sp.PHASE3_TVL_CAP_USDC.quantize(Decimal("1"))
        )

    def test_no_benchmark_and_no_price_target_are_published(self) -> None:
        f = sp.check_no_valid_denial_benchmark()
        self.assertFalse(f["publishes_ratio"])
        self.assertFalse(f["publishes_price_target"])

    def test_the_refuted_benchmark_helper_is_gone(self) -> None:
        """intake_denial priced admission, not decisions. Not re-pointable."""
        self.assertFalse(hasattr(sp, "cheapest_priced_denial_channel"))
        self.assertFalse(hasattr(sp, "equalization"))
        self.assertFalse(hasattr(sp, "required_uplift"))

    def test_allocation_rationale_survives_and_pricing_rationale_does_not(self) -> None:
        """N14 still has a case; it is just not the threat-cost one."""
        f = sp.check_no_valid_denial_benchmark()
        self.assertIn("allocation", f["n14_rationale_that_survives"])
        self.assertIn("underpriced", f["n14_rationale_that_does_not"])


class ArmingConditionTests(unittest.TestCase):
    """SQ-575. The tripwire fired and was rewritten, not relaxed."""

    def test_switch_on_half_is_now_enforced(self) -> None:
        f = sp.check_arming_condition_enforcement(REPO_ROOT)
        self.assertTrue(f["external_side_accounted"])
        self.assertTrue(f["switch_on_enforced"])

    def test_continuous_half_is_still_open_and_says_why(self) -> None:
        """Not an oversight: the instantaneous protocol-depth sum is zero for
        most of an epoch, so enforcing at register would close the service
        outside Bleavit's own decision windows."""
        f = sp.check_arming_condition_enforcement(REPO_ROOT)
        self.assertFalse(f["continuously_enforced"])
        self.assertFalse(f["fully_enforced"])
        self.assertIn("does not blink", f["open_half"])

    def test_detector_looks_for_mechanism_not_prose(self) -> None:
        """An earlier draft matched the string `b_ext`, which appears in
        comments — so a doc-only edit would have reported enforcement."""
        doc_only = (REPO_ROOT / "docs/architecture/16-hosted-question-service.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("b_ext", doc_only)
        f = sp.check_arming_condition_enforcement(REPO_ROOT)
        self.assertFalse(f["fully_enforced"])


class StarvationResponseTests(unittest.TestCase):
    """16 §8.7. Pinned on mechanism, per the SQ-575 tripwire's lesson."""

    def test_the_response_shipped_and_is_no_longer_only_a_promise(self) -> None:
        f = sp.check_starvation_response_shape(REPO_ROOT)
        self.assertTrue(f["section_present"])
        self.assertTrue(f["implemented"])
        self.assertFalse(f["still_only_a_governance_promise"])

    def test_the_two_halves_combine_by_max_not_by_a_product(self) -> None:
        """A product reaches svc.price_cap^2, so `M <= cap` would stop holding
        by construction and would need a second row to bound."""
        self.assertTrue(sp.check_starvation_response_shape(REPO_ROOT)["combines_by_max"])

    def test_starvation_is_never_ratcheted_into_the_stored_price(self) -> None:
        """Storing it would decay a transient starvation out over svc.max_window
        — a price outliving the condition that set it."""
        f = sp.check_starvation_response_shape(REPO_ROOT)
        self.assertTrue(f["starvation_never_stored"])

    def test_only_still_accruing_windows_price(self) -> None:
        """A closed window's integral is frozen, so reading it would let one
        historically underfunded book surcharge every later admission — the
        very 'price outliving its cause' §8.6 refuses to store."""
        f = sp.check_starvation_response_shape(REPO_ROOT)
        self.assertTrue(f["only_live_windows_price"])

    def test_both_halves_of_the_liveness_guard_are_present(self) -> None:
        """Separately, because each closes a case the other misses: a window
        sealed early while the clock says it is open, and a window past its end
        that the epoch crank has not sealed yet."""
        f = sp.check_starvation_response_shape(REPO_ROOT)
        self.assertTrue(f["rejects_sealed_windows"])
        self.assertTrue(f["rejects_closed_windows"])

    def test_no_second_ceiling_key_was_added(self) -> None:
        """R-2 step 1: a new key whose job an existing key already does is a
        defect. One adopted row must keep arming both halves of M."""
        f = sp.check_starvation_response_shape(REPO_ROOT)
        self.assertEqual(f["extra_ceiling_keys"], [])
        self.assertTrue(f["shares_one_ceiling"])


class ThreatRowTests(unittest.TestCase):
    def test_th72_cost_cell_carries_no_figure(self) -> None:
        finding = sp.check_th72_attack_cost_is_unpriced(REPO_ROOT)
        self.assertTrue(finding["row_found"])
        self.assertTrue(finding["cost_cell_has_no_figure"])
        self.assertFalse(finding["priced_in_threat_costs"])

    def test_the_finding_reports_itself_unresolved(self) -> None:
        """The dict is the machine-readable status, so it must not claim a
        repair the module did not make. It once carried
        `repaired_by: "N14 - attacker_cost_per_epoch fills the cell"`, naming a
        function that has never existed and contradicting the three fields
        beside it -- a report tool reading this would have closed SQ-574."""
        finding = sp.check_th72_attack_cost_is_unpriced(REPO_ROOT)
        self.assertFalse(finding["resolved"])
        self.assertEqual(finding["open_question"], "SQ-574")
        self.assertNotIn("repaired_by", finding)

    def test_no_field_claims_a_repair_that_does_not_exist(self) -> None:
        """Structural, not string-matched on the old key: any *future* field
        may claim a repair only by naming a callable this module really has."""
        finding = sp.check_th72_attack_cost_is_unpriced(REPO_ROOT)
        self.assertFalse(hasattr(sp, "attacker_cost_per_epoch"))
        for key, value in finding.items():
            if not isinstance(value, str):
                continue
            for word in value.replace(",", " ").split():
                name = word.strip("`'\"()")
                if name.endswith("_per_epoch") or name.startswith("check_"):
                    self.assertTrue(
                        hasattr(sp, name),
                        f"{key} names {name!r}, which this module does not define",
                    )

    def test_carrying_cost_is_a_lower_bound_not_the_attack_cost(self) -> None:
        """Why the cell stays empty: the maker-loss term is missing, so the
        derived figure understates and doc 14 may not publish it as the cost."""
        self.assertTrue(hasattr(sp, "carrying_cost_per_epoch"))
        self.assertIn("NOT the attack cost", sp.carrying_cost_per_epoch.__doc__ or "")

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
        sp.check_no_valid_denial_benchmark()
        for cls in sp.POL_B_DECISION:
            sp.carrying_cost_per_epoch(cls)
        self.assertEqual(getcontext().prec, before)

    def test_zero_and_negative_inputs_refuse(self) -> None:
        with self.assertRaises(sp.SlotPricingError):
            sp.parity_depth_cash(Decimal(0))
        with self.assertRaises(sp.SlotPricingError):
            sp.parity_depth_cash(Decimal(10_000), slate=0)
        with self.assertRaises(sp.SlotPricingError):
            sp.fee_at_minimum_declared_stake(Decimal(-1))


if __name__ == "__main__":
    unittest.main()
