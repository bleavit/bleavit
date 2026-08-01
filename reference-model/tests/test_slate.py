"""Execute 08 §3–§7's POL budget, shrink and monopolization claims.

The suite derives commitments from §3/§5.3, searches every class multiset up
to ``epoch.slots``, composes a blanking run with 05 §2.1's imported T6/T26
table, and parses the two documents that publish the monopolization price.
False claims are pinned as structured SQ-543 findings, following the established
sustainability-suite pattern; no deliberately failing or self-referential test
is used.
"""

from decimal import Decimal
from pathlib import Path
import tempfile
import unittest

from bleavit_reference_model.slate import (
    CLASS_ORDER,
    DEFAULTS,
    NAV_FLOORS,
    NAV_FLOOR_META,
    POL_BUDGET_DEFAULT,
    POL_BUDGET_MAX,
    SEC_FLOW_CAP_MIN,
    SlateError,
    asymptotic_budget_ratio,
    asymptotic_commitment_slope,
    check_claims,
    cheapest_blanking_attack,
    class_blanking_attack,
    class_margin_ratio,
    commitment_ratio,
    document_monopolization_prices,
    epoch_budget,
    floor_commitment,
    funded_prefix,
    funding_frontier,
    funding_nav_threshold,
    intake_cost_table,
    largest_fundable_treasury_ask,
    make_proposal,
    max_fundable,
    nav_floor_met,
    proposal_prize,
    scaled_commitment,
    search_shrink,
    two_epoch_blanking_run,
    worked_sizing_example,
)
from bleavit_reference_model.treasury import display_integer


D = Decimal
REPO_ROOT = Path(__file__).resolve().parents[2]


class CommitmentDerivationTests(unittest.TestCase):
    """08 §3 and §5.4 arithmetic before it meets the epoch budget."""

    def test_floor_commitments_reproduce_all_four_published_figures(self):
        expected = {
            "param": 34_657,
            "treasury": 55_452,
            "code": 103_972,
            "meta": 159_424,
        }
        for proposal_class, published in expected.items():
            with self.subTest(proposal_class=proposal_class):
                self.assertEqual(display_integer(floor_commitment(proposal_class)), published)

    def test_frozen_nav_floors_and_their_claimant_adverse_residuals_reproduce(self):
        expected = {
            "param": (D(4_620_989), D("7.796267")),
            "treasury": (D(7_393_600), D("30.074027")),
            "code": (D(13_862_944), D("0.388801")),
            "meta": (D(21_256_533), D("19.462828")),
        }
        for proposal_class, (published, residual) in expected.items():
            with self.subTest(proposal_class=proposal_class):
                self.assertEqual(NAV_FLOORS[proposal_class], published)
                exact = floor_commitment(proposal_class) / POL_BUDGET_DEFAULT
                self.assertAlmostEqual(published - exact, residual, places=6)
                self.assertGreaterEqual(published, exact)

    def test_loud_gate_predicate_changes_only_at_the_frozen_literal(self):
        for proposal_class, floor in NAV_FLOORS.items():
            with self.subTest(proposal_class=proposal_class):
                self.assertFalse(nav_floor_met(proposal_class, floor - D("0.000001")))
                self.assertTrue(nav_floor_met(proposal_class, floor))

    def test_code_normative_seeding_reproduces_the_worked_recomputation(self):
        example = worked_sizing_example("code", nav=D(13_862_944))
        self.assertEqual(example.prize, D("693147.200000"))
        self.assertAlmostEqual(example.b, D("121751.147128"), places=6)
        self.assertAlmostEqual(example.pol_depth, D("168782.928723"), places=6)
        self.assertAlmostEqual(example.liquidity_hat, D("1555077.328723"), places=6)
        self.assertEqual(example.attack_cost, D("2332615.993084"))
        self.assertTrue(example.passes)

    def test_treasury_normative_seeding_reproduces_the_worked_recomputation(self):
        example = worked_sizing_example(
            "treasury", nav=D(9_523_810), ask=D(200_000)
        )
        self.assertAlmostEqual(example.b, D("35129.954251"), places=6)
        self.assertAlmostEqual(example.pol_depth, D("48700.457485"), places=6)
        self.assertAlmostEqual(example.liquidity_hat, D("448700.457485"), places=6)
        self.assertEqual(example.attack_cost, D("673050.686227"))
        self.assertTrue(example.passes)

    def test_the_worked_examples_intentionally_use_the_flow_cap_minimum(self):
        # 08 §5.4 says ×7 twice. The unsafe direction is upward, so deriving
        # the guarantee at the lawful minimum is conservative, not a defect.
        example = worked_sizing_example(
            "treasury", nav=D(9_523_810), ask=D(200_000), flow_cap=SEC_FLOW_CAP_MIN
        )
        self.assertEqual(example.contest_capital, D(400_000))
        self.assertTrue(example.passes)

    def test_sq_543_the_class_invariance_parenthetical_is_false_for_meta(self):
        """SQ-543. 08 §5.4(a) says the ratio is class-invariant.

        PARAM, TREASURY and CODE are identical, but META's 1.2M v_min is
        twelve times its b floor rather than ten. Its ratio is smaller, so the
        parenthetical does not describe all four defaults.
        """
        first_three = [class_margin_ratio(name) for name in CLASS_ORDER[:3]]
        for ratio in first_three[1:]:
            self.assertAlmostEqual(ratio, first_three[0], places=90)
        self.assertAlmostEqual(
            first_three[0], D("0.1217511437130580782875390059"), places=28
        )
        self.assertAlmostEqual(
            class_margin_ratio("meta"),
            D("0.1035607258978513851701803700"),
            places=28,
        )
        self.assertNotEqual(class_margin_ratio("meta"), first_three[0])


class PolBudgetWedgeTests(unittest.TestCase):
    """§5.3's scaled slope composed with §3/§4.4's NAV budget."""

    NAV_GRID = tuple(
        D(value)
        for value in (
            "5000000",
            "13862944",
            "21256533",
            "25000000",
            "50000000",
            "100000000",
            "1000000000",
            "1000000000000",
        )
    )

    def test_default_code_meta_and_max_treasury_are_unfundable_across_the_grid(self):
        for proposal_class in ("treasury", "code", "meta"):
            for nav in self.NAV_GRID:
                with self.subTest(proposal_class=proposal_class, nav=str(nav)):
                    self.assertGreater(
                        scaled_commitment(proposal_class, nav), epoch_budget(nav)
                    )

    def test_param_is_not_an_upgrade_class_and_is_fundable_from_five_million(self):
        # §5.2 assigns PARAM its capability envelope, not a 5%-of-NAV upgrade
        # floor. Inventing one merely to make a four-class wedge is not lawful.
        self.assertEqual(proposal_prize("param", D(5_000_000)), D("50000.000000"))
        for nav in self.NAV_GRID:
            with self.subTest(nav=str(nav)):
                self.assertLessEqual(scaled_commitment("param", nav), epoch_budget(nav))
        self.assertEqual(asymptotic_commitment_slope("param"), D(0))

    def test_default_asymptotes_are_derived_from_the_scaling_formula(self):
        self.assertAlmostEqual(
            asymptotic_budget_ratio("code"),
            D("1.623348582840774377167186745"),
            places=27,
        )
        self.assertAlmostEqual(
            asymptotic_budget_ratio("treasury"),
            asymptotic_budget_ratio("code"),
            places=90,
        )
        self.assertAlmostEqual(
            asymptotic_budget_ratio("meta"),
            D("1.380809678638018468935738267"),
            places=27,
        )
        # The fixed four-gate term keeps every finite-NAV ratio above its limit.
        self.assertGreater(
            commitment_ratio("code", D("1e12")),
            asymptotic_budget_ratio("code"),
        )

    def test_the_worked_code_point_is_1_823x_over_budget(self):
        self.assertAlmostEqual(
            commitment_ratio("code", D(13_862_944)),
            D("1.823348577231560435"),
            places=18,
        )

    def test_smallest_perbill_that_ever_funds_code_is_12175115_ppb(self):
        frontier = funding_frontier("code")
        self.assertEqual(frontier.minimum_budget_ppb, 12_175_115)
        self.assertEqual(frontier.minimum_budget_fraction, D("0.012175115"))
        self.assertGreater(frontier.nav_threshold, D("33075564679519"))
        self.assertLess(frontier.nav_threshold, D("33075564680000"))
        self.assertGreater(frontier.kernel_ceiling_nav_threshold, D("7361153.034154"))
        self.assertLess(frontier.kernel_ceiling_nav_threshold, D("7361153.034200"))
        self.assertIsNone(funding_nav_threshold("code", POL_BUDGET_DEFAULT))
        self.assertIsNone(funding_nav_threshold("code", D("0.012175114")))

    def test_kernel_ceiling_funds_code_only_above_its_derived_threshold(self):
        threshold = funding_nav_threshold("code", POL_BUDGET_MAX)
        self.assertIsNotNone(threshold)
        assert threshold is not None
        ceiling = DEFAULTS.__class__(pol_budget_epoch=POL_BUDGET_MAX)
        self.assertGreaterEqual(
            epoch_budget(threshold, ceiling),
            scaled_commitment("code", threshold, params=ceiling),
        )
        self.assertLess(
            epoch_budget(threshold - D("0.000001"), ceiling),
            scaled_commitment("code", threshold - D("0.000001"), params=ceiling),
        )

    def test_max_treasury_ask_has_the_code_slope_but_exceeds_fundable_ask(self):
        nav = D(25_000_000)
        fundable = largest_fundable_treasury_ask(nav)
        self.assertIsNotNone(fundable)
        assert fundable is not None
        self.assertAlmostEqual(fundable, D("684616.092708"), places=6)
        self.assertEqual(DEFAULTS.cap_proposal * nav, D(1_250_000))
        self.assertLess(fundable, DEFAULTS.cap_proposal * nav)
        self.assertAlmostEqual(
            asymptotic_commitment_slope("treasury"),
            asymptotic_commitment_slope("code"),
            places=90,
        )

    def test_zero_budget_ratio_refuses_instead_of_dividing(self):
        zero = DEFAULTS.__class__(pol_budget_epoch=D(0))
        with self.assertRaises(SlateError):
            commitment_ratio("code", D(25_000_000), params=zero)

    def test_budget_frontier_refuses_a_rate_above_the_kernel_ceiling(self):
        with self.assertRaises(SlateError):
            funding_nav_threshold("code", D("0.015000001"))


class ShrinkToFitTests(unittest.TestCase):
    """The specified bond-priority prefix against trivial cardinality packing."""

    def test_adding_meta_to_four_params_reduces_four_funded_to_one(self):
        nav = NAV_FLOOR_META
        budget = epoch_budget(nav)
        params = tuple(make_proposal("param", pid) for pid in range(4))
        expanded = params + (make_proposal("meta", 4),)
        self.assertEqual(len(funded_prefix(params, budget)), 4)
        self.assertEqual(len(funded_prefix(expanded, budget)), 1)
        self.assertEqual(len(max_fundable(expanded, budget)), 4)

    def test_exhaustive_above_floor_search_finds_the_three_slot_drop(self):
        grid = tuple(
            D(value)
            for value in (
                "21256533",
                "23104906",
                "25000000",
                "40000000",
                "106282533",
                "150000000",
            )
        )
        result = search_shrink(grid)
        # Sum C(4+n-1,n), n=0..5 = 126 multisets at each of six NAV points.
        self.assertEqual(result.combinations_checked, 756)
        self.assertEqual(result.addition.drop, 3)
        self.assertEqual(result.addition.base, ("param",) * 4)
        self.assertEqual(result.addition.expanded, ("param",) * 4 + ("meta",))
        self.assertEqual(result.packing.gap, 3)
        # With floor commitments, a larger budget never funds fewer entries.
        self.assertEqual(result.nav.drop, 0)

    def test_scaled_code_upgrade_can_zero_an_above_floor_param_slate(self):
        nav = D(25_000_000)
        code = make_proposal(
            "code", 0, nav=nav, scaled=True, upgrade_payload=True
        )
        params = tuple(make_proposal("param", pid + 1) for pid in range(4))
        self.assertGreater(code.commitment, epoch_budget(nav))
        self.assertEqual(funded_prefix((code,) + params, epoch_budget(nav)), ())
        self.assertEqual(len(max_fundable((code,) + params, epoch_budget(nav))), 4)

    def test_negative_budget_refuses(self):
        with self.assertRaises(SlateError):
            funded_prefix((make_proposal("param", 0),), D(-1))


class BlankingEconomicsTests(unittest.TestCase):
    """08 §7's table versus the cheapest path through T5 and §4.4."""

    def test_section_seven_table_reproduces_exactly(self):
        table = intake_cost_table()
        self.assertEqual(table.intake_locked, D(64_000))
        self.assertEqual(table.intake_slashed, D(6_400))
        self.assertEqual(table.slot_locked, D(125_000))
        self.assertEqual(table.slot_slashed, D(12_500))
        self.assertEqual(table.combined_locked, D(189_000))
        self.assertEqual(table.combined_slashed, D(18_900))
        self.assertEqual(table.intake_accounts, 16)

    def test_sq_543_cheapest_blank_is_five_earlier_pid_params_for_500(self):
        """SQ-543. 08 §7 says every monopolization path costs five figures.

        Five PARAM entries win the pid-ascending tie against an honest PARAM
        slate and occupy all five qualification slots. At 25M they all fit and
        forfeit 10% of 1,000 each: 500 USDC, with two funding accounts under
        the four-entry cap. No META arming is needed.
        """
        attack = cheapest_blanking_attack(D(25_000_000))
        self.assertIsNotNone(attack)
        assert attack is not None
        self.assertEqual(attack.proposal_class, "param")
        self.assertEqual(attack.submitted, 5)
        self.assertEqual(attack.funded_attackers, 5)
        self.assertEqual(attack.funding_accounts, 2)
        self.assertEqual(attack.per_epoch_cost, D(500))
        self.assertEqual(attack.required_phase, 4)
        self.assertTrue(attack.blanked)

    def test_meta_channel_reproduces_the_audited_cost_curve(self):
        expected = {
            D(23_104_906): D(5_000),
            D(25_000_000): D(5_000),
            D(30_000_000): D(5_000),
            D(40_000_000): D(5_000),
            D(60_000_000): D(10_000),
            D(106_282_533): D(20_000),
            D(150_000_000): D(25_000),
        }
        for nav, cost in expected.items():
            with self.subTest(nav=str(nav)):
                attack = class_blanking_attack(nav, "meta")
                self.assertIsNotNone(attack)
                assert attack is not None
                self.assertEqual(attack.per_epoch_cost, cost)
                self.assertEqual(attack.required_phase, 6)
                self.assertEqual(
                    attack.funding_accounts,
                    2 if attack.submitted == 5 else 1,
                )

    def test_meta_is_not_needed_even_after_phase_six(self):
        phase4 = cheapest_blanking_attack(D(25_000_000), max_phase=4)
        phase6 = cheapest_blanking_attack(D(25_000_000), max_phase=6)
        self.assertIsNotNone(phase4)
        self.assertIsNotNone(phase6)
        assert phase4 is not None and phase6 is not None
        self.assertEqual(phase4.proposal_class, "param")
        self.assertEqual(phase6.proposal_class, "param")
        self.assertEqual(phase4.per_epoch_cost, phase6.per_epoch_cost)

    def test_two_blanks_import_t6_then_terminal_t26(self):
        attack = cheapest_blanking_attack(D(25_000_000))
        assert attack is not None
        run = two_epoch_blanking_run(attack)
        self.assertEqual(run.transition_tags, ("T6", "T26"))
        self.assertEqual(run.first.state, "Submitted")
        self.assertIn("deferred_once", run.first.flags)
        self.assertEqual(run.terminal.state, "Cancelled")
        self.assertEqual(run.attacker_cost, D(1_000))


class CrossDocumentFindingTests(unittest.TestCase):
    """Document extraction and the structured SQ-543 defect rows."""

    def test_sq_543_the_derived_monopolization_price_is_18_900(self):
        """SQ-543. The bond schedule derives 18,900 USDC per epoch.

        The structured finding, rather than this assertion, carries the stale
        cross-document publication and its source-side discrepancy.
        """
        derived = intake_cost_table().combined_slashed
        prices = document_monopolization_prices(REPO_ROOT)
        self.assertEqual(derived, D(18_900))
        self.assertEqual(prices.doc08_combined, derived)
        self.assertFalse(prices.agree)
        finding = next(
            row
            for row in check_claims(REPO_ROOT)
            if row.key == "08 §7 and 14 TH-16 publish one monopolization price"
        )
        self.assertFalse(finding.ok)

    def test_repaired_threat_price_makes_the_document_parser_agree(self):
        """SQ-543. A repaired TH-16 is a positive control for the parser."""
        doc08 = (
            REPO_ROOT / "docs/architecture/08-treasury-and-economics.md"
        ).read_text(encoding="utf-8")
        doc14 = (REPO_ROOT / "docs/architecture/14-threat-model.md").read_text(
            encoding="utf-8"
        )
        repaired_doc14 = doc14.replace(
            "forfeits ~10.9k USDC", "forfeits ~18.9k USDC", 1
        )
        self.assertNotEqual(repaired_doc14, doc14)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            architecture = root / "docs/architecture"
            architecture.mkdir(parents=True)
            (architecture / "08-treasury-and-economics.md").write_text(
                doc08, encoding="utf-8"
            )
            (architecture / "14-threat-model.md").write_text(
                repaired_doc14, encoding="utf-8"
            )
            prices = document_monopolization_prices(root)
        self.assertTrue(prices.agree)
        self.assertEqual(prices.doc14_th16, intake_cost_table().combined_slashed)

    def test_parsed_section_seven_price_equals_its_derived_schedule(self):
        prices = document_monopolization_prices(REPO_ROOT)
        self.assertEqual(prices.doc08_combined, intake_cost_table().combined_slashed)

    def test_every_falsified_claim_is_queryable(self):
        """SQ-543. Every derived failure remains available to callers."""
        findings = {row.key: row for row in check_claims(REPO_ROOT)}
        expected_false = {
            "scaled CODE commitment fits pol.budget_epoch",
            "maximum TREASURY ask is POL-fundable",
            "bond-priority prefix maximizes funded count",
            "every monopolization path costs five figures per epoch",
            "08 §7 and 14 TH-16 publish one monopolization price",
            "b_floor*ln2/P_ref is class-invariant",
        }
        self.assertEqual(set(findings), expected_false)
        for key in sorted(expected_false):
            with self.subTest(claim=key):
                self.assertFalse(findings[key].ok)


if __name__ == "__main__":
    unittest.main()
