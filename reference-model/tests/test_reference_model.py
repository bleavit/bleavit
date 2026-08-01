import copy
from decimal import Decimal, ROUND_HALF_UP, getcontext
import json
from pathlib import Path
import unittest

from bleavit_reference_model import lmsr, treasury
from bleavit_reference_model.decision import (
    Grade,
    Outcome,
    RejectReason,
    decide,
    gate_decision_grade,
    grade_welfare_book,
    requires_gate_markets,
)
from bleavit_reference_model.ledger import (
    DEFAULT_REDEEM_FEE_PERBILL,
    MIN_SPLIT,
    PERBILL_ONE,
    BaselineState,
    BaselineVault,
    Branch,
    FeeTreatment,
    GateSide,
    GateType,
    PositionKind,
    ScalarSide,
    Vault,
    VaultState,
    effective_redeem_fee,
    redemption_fee,
    redemption_fee_pair,
)
from bleavit_reference_model.lmsr import (
    PriceBoundExceeded,
    buy_delta_cost,
    vectors_v1_v6,
    worked_maker_example,
)
from bleavit_reference_model.treasury import (
    attack_cost_hat,
    baseline_commitment,
    dec_v_min,
    l_hat,
    manip_floor_hat,
    decision_delta,
    display_integer,
    in_cap_prize,
    nav,
    nav_floor,
    p_ref,
    pol_b,
    pol_commitment,
    security_sizing_ok,
)
from bleavit_reference_model.twap import (
    ContestCapitalAccumulator,
    TwapAccumulator,
    marked_open_interest,
)
from bleavit_reference_model.welfare import (
    collator_d_eff,
    floor_64x64,
    full_pipeline,
    gate,
    normalization_sample,
    normalize_metric,
    percentile,
    settlement_score,
    weighted_geometric,
)


class ReferenceModelTests(unittest.TestCase):
    def test_normative_lmsr_vectors(self):
        v = vectors_v1_v6()
        self.assertTrue(v["V1"]["value"].startswith("512.494795136"))
        self.assertTrue(v["V2"]["value"].startswith("0.524979187478"))
        self.assertTrue(v["V3"]["delta"].startswith("4054.65108108"))
        self.assertTrue(v["V4"]["value"].startswith("6931.47180559"))
        self.assertTrue(v["V5"]["net_fees_only"].startswith("-3.074968"))
        self.assertEqual(
            {
                key: v["V6"][key]
                for key in ("b", "q_long", "q_short", "side", "amount")
            },
            {
                "b": "10000",
                "q_long": "480000",
                "q_short": "0",
                "side": "long",
                "amount": "1",
            },
        )
        with self.assertRaises(PriceBoundExceeded):
            buy_delta_cost(10000, 480000, 0, "long", 1)

    def test_lmsr_maker_loss_worked_example(self):
        row = worked_maker_example()
        self.assertAlmostEqual(float(row["loss"]), 180.4, places=1)
        self.assertAlmostEqual(float(row["delta"]), 6029.05, places=2)
        self.assertAlmostEqual(
            float(row["displacement_revenue"]), 3195.83, places=2
        )
        self.assertAlmostEqual(
            float(row["expected_payout"]), 3376.27, places=2
        )

    def test_twap_backward_accumulator_and_mean(self):
        twap = TwapAccumulator(Decimal("0.500"))
        first = twap.observe(10, Decimal("0.900"))
        second = twap.observe(20, Decimal("0.900"))
        self.assertEqual(first, Decimal("0.502500"))
        self.assertEqual(second, Decimal("0.505012500"))
        self.assertEqual(twap.mean(0, 20), Decimal("0.503756250"))
        self.assertEqual(twap.mean(10, 20), second)

    def test_twap_clamp_widens_and_tracks_staleness(self):
        twap = TwapAccumulator(Decimal("0.500"))
        # Exact finite decimal of 0.5*(1.005^10); ambient-precision arithmetic
        # would round it and diverge from the model (which is exact).
        expected = Decimal("0.525570066020395321298833007812500")
        self.assertEqual(twap.observe(100, Decimal("0.900")), expected)
        self.assertEqual(twap.stale_events, 1)
        fresh = TwapAccumulator(Decimal("0.500"))
        fresh.observe(50, Decimal("0.900"))
        self.assertEqual(fresh.stale_events, 0)

    def test_window_staleness_clips_to_the_window_and_counts_the_close(self):
        # 04 §7: gaps > 50 blocks *inside* the decision window, terminal gap
        # included. The running `stale_events` counter is book-level and cannot
        # express either half of that rule.
        twap = TwapAccumulator(Decimal("0.500"))
        for block in range(10, 101, 10):
            twap.observe(block, Decimal("0.500"))
        # Quiet from 100 to the close at 200: one terminal gap.
        self.assertEqual(twap.stale_events_in(0, 200), 1)
        # ... and none of it is visible to the book-level counter, which only
        # ever sees the 10-block intervals it was cranked on.
        self.assertEqual(twap.stale_events, 0)
        # Cranked all the way to the close: clean.
        for block in range(110, 201, 10):
            twap.observe(block, Decimal("0.500"))
        self.assertEqual(twap.stale_events_in(0, 200), 0)

        # Clipping: a 120-block gap that lies mostly before the window is
        # charged only for the 39 blocks the window actually covers.
        clipped = TwapAccumulator(Decimal("0.500"))
        clipped.observe(20, Decimal("0.500"))
        for block in range(140, 201, 10):
            clipped.observe(block, Decimal("0.500"))
        self.assertEqual(clipped.stale_events_in(100, 200), 0)
        self.assertEqual(clipped.stale_events, 1)  # book-level sees 20 -> 140

        # Exactly 50 is not a gap; 51 is. Two gaps force reject.
        boundary = TwapAccumulator(Decimal("0.500"))
        for block in [10, 100, 150]:
            boundary.observe(block, Decimal("0.500"))
        self.assertEqual(boundary.stale_events_in(0, 150), 1)
        self.assertEqual(boundary.stale_events_in(0, 300), 2)

        # An entirely uncranked window is one gap, not one per missed interval.
        self.assertEqual(
            TwapAccumulator(Decimal("0.500")).stale_events_in(0, 100), 1
        )
        # A degenerate window has no interior to be stale in.
        self.assertEqual(
            TwapAccumulator(Decimal("0.500")).stale_events_in(100, 100), 0
        )

    def test_ledger_full_operation_families_and_void_leg_floors(self):
        vault = Vault()
        vault.split(10_000_003)
        vault.split_scalar(Branch.ACCEPT, 4_000_003)
        vault.merge_scalar(Branch.ACCEPT, 1_000_000)
        vault.split_gate(Branch.REJECT, GateType.SECURITY, 2_000_001)
        vault.transfer(1)
        vault.void()
        self.assertEqual(vault.state, VaultState.VOIDED)
        self.assertEqual(
            vault.redeem_void(
                Branch.ACCEPT,
                PositionKind.BRANCH_USDC,
                7_000_000,
            ),
            3_500_000,
        )
        self.assertEqual(
            vault.redeem_void(
                Branch.ACCEPT,
                PositionKind.LONG,
                3_000_003,
            ),
            750_000,
        )
        self.assertEqual(
            vault.redeem_void(
                Branch.REJECT,
                PositionKind.GATE_YES,
                2_000_001,
                GateType.SECURITY,
            ),
            500_000,
        )
        vault.check_conservation()

    def test_void_is_never_legal_after_scalar_settlement(self):
        vault = Vault()
        vault.split(100)
        vault.resolve(Branch.ACCEPT)
        vault.settle_scalar(Decimal("0.5"))
        with self.assertRaises(ValueError):
            vault.void()

    def test_void_claim_bound_values_pairs_before_unmatched_floors(self):
        # 03 §6.4/§6.5: both scalar and gate pairs can merge into
        # branch-USDC, after which cross-branch pairs redeem at par. Valuing
        # every live leg directly at floor(a/4), as the old oracle did,
        # therefore understates the maximal remaining liability.
        vault = Vault()
        vault.split(20_006)
        for branch in Branch:
            vault.split_scalar(branch, 10_003)
            vault.split_gate(
                branch, GateType.SURVIVAL, 10_003
            )
        vault.void()

        direct_floor_bound = 0
        for supply in vault.branches.values():
            direct_floor_bound += supply.usdc // 2
            direct_floor_bound += supply.long // 4
            direct_floor_bound += supply.short // 4
            for gate in GateType:
                direct_floor_bound += supply.gate_yes[gate] // 4
                direct_floor_bound += supply.gate_no[gate] // 4

        self.assertEqual(direct_floor_bound, 20_000)
        self.assertEqual(vault._claim_bound(), 20_006)
        self.assertGreater(vault._claim_bound(), direct_floor_bound)
        vault.check_conservation()

    def test_b5_scalar_fragmentation_vector(self):
        vault = Vault()
        vault.split(20_000)
        vault.split_scalar(Branch.ACCEPT, 20_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_scalar(Decimal("0.70005"))
        long_payout = vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.LONG, 20_000
        )
        short_a = vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.SHORT, 10_000
        )
        short_b = vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.SHORT, 10_000
        )
        self.assertEqual(long_payout, 14_001)
        self.assertEqual(short_a, 2_999)
        self.assertEqual(short_b, 2_999)
        self.assertEqual(long_payout + short_a + short_b, 19_999)
        self.assertLessEqual(vault.total_payouts, vault.collateral_in)
        vault.check_conservation()

    def test_scalar_pair_is_exact(self):
        vault = Vault()
        vault.split(20_000)
        vault.split_scalar(Branch.ACCEPT, 20_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_scalar(Decimal("0.70005"))
        self.assertEqual(
            vault.redeem_scalar_pair(Branch.ACCEPT, 20_000), 20_000
        )
        vault.check_conservation()

    def test_gate_settlement_pays_one_zero(self):
        vault = Vault()
        vault.split(1_000)
        vault.split_gate(Branch.ACCEPT, GateType.SURVIVAL, 1_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_gate(GateType.SURVIVAL, True)
        vault.settle_scalar(Decimal("0.5"))
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT,
                GateType.SURVIVAL,
                GateSide.YES,
                400,
            ),
            400,
        )
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT,
                GateType.SURVIVAL,
                GateSide.NO,
                400,
            ),
            0,
        )
        vault.check_conservation()

    def test_baseline_scalar_and_pair_redemptions(self):
        baseline = BaselineVault(epoch=4)
        baseline.split_baseline(20_000)
        baseline.settle_baseline(Decimal("0.70005"))
        self.assertEqual(
            baseline.redeem_baseline(ScalarSide.LONG, 10_000), 7_000
        )
        self.assertEqual(baseline.redeem_baseline_pair(10_000), 10_000)
        baseline.check_conservation()

    def test_ledger_sequence_fixture_covers_full_operation_alphabet(self):
        # 15 §4.4 / 03 §11: one generated JSON corpus drives the Python↔Rust
        # differential, including gate, Baseline, VOID, and pair paths. The
        # FRAME-only sweep surface has its own generated pallet scenarios.
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "fixtures"
                / "vectors.json"
            ).read_text()
        )
        scenarios = fixture["ledger_sequence_scenarios"]
        self.assertEqual(fixture["schema"], "bleavit.reference-model.v4")
        self.assertEqual(len(scenarios), 64)
        self.assertEqual(
            {scenario["coverage_intent"] for scenario in scenarios},
            {
                "void-after-open",
                "void-after-resolved",
                "gate-settle-then-pair-redemption",
                "gate-false-and-unpaired-rounding",
                "baseline-pair-redemption",
                "baseline-unpaired-rounding",
                "terminal-residue-for-pallet-split",
                "illegal-terminal-interleavings",
            },
        )
        operations = {
            row["op"] for scenario in scenarios for row in scenario["ops"]
        }
        self.assertEqual(
            operations,
            {
                "split",
                "merge",
                "split_scalar",
                "merge_scalar",
                "split_gate",
                "merge_gate",
                "transfer",
                "resolve",
                "void",
                "settle_scalar",
                "settle_gate",
                "redeem",
                "redeem_void",
                "redeem_scalar",
                "redeem_scalar_pair",
                "redeem_gate",
                "split_baseline",
                "merge_baseline",
                "settle_baseline",
                "redeem_baseline",
                "redeem_baseline_pair",
            },
        )
        for scenario in scenarios:
            self.assertRegex(scenario["seed"], r"^0x[0-9A-F]{16}$")
            self.assertTrue(scenario["ops"])
            for row in scenario["ops"]:
                self.assertEqual(
                    len({"ok", "err"}.intersection(row["outcome"])), 1
                )

    def test_ledger_sequence_fixture_has_errors_and_flooring_vectors(self):
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "fixtures"
                / "vectors.json"
            ).read_text()
        )
        rows = [
            row
            for scenario in fixture["ledger_sequence_scenarios"]
            for row in scenario["ops"]
        ]
        self.assertTrue(any("err" in row["outcome"] for row in rows))
        error_classes = {
            row["outcome"]["err"]
            for row in fixture["ledger_error_scenarios"]
        }
        self.assertEqual(
            error_classes,
            {
                "UnknownVault",
                "UnknownBaselineVault",
                "WrongVaultState",
                "AmountTooSmall",
                "ArithmeticOverflow",
                "InsufficientPosition",
                "PositionCapExceeded",
                "InvalidScore",
                "GateAlreadySettled",
                "GateNotSettled",
            },
        )
        successful = [row for row in rows if "ok" in row["outcome"]]
        self.assertTrue(
            any(
                row["op"] == "redeem_void"
                and row["args"]["amount"] % 4 != 0
                and row["outcome"]["ok"]["payout"]
                == row["args"]["amount"] // 4
                for row in successful
            )
        )
        for pair_op in ("redeem_scalar_pair", "redeem_baseline_pair"):
            self.assertTrue(
                any(
                    row["op"] == pair_op
                    and row["outcome"]["ok"]["payout"]
                    == row["args"]["amount"]
                    for row in successful
                )
            )

    def test_ledger_fixture_covers_score_endpoints_and_rounding_boundary(self):
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "fixtures"
                / "vectors.json"
            ).read_text()
        )
        scores = {
            row["score"] for row in fixture["ledger_score_scenarios"]
        }
        self.assertTrue(
            {
                0,
                1_000_000_000,
                700_049_999,
                700_050_000,
                700_050_001,
            }.issubset(scores)
        )

    def test_sweep_fixture_is_python_derived_and_batched(self):
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "fixtures"
                / "vectors.json"
            ).read_text()
        )
        scenarios = fixture["ledger_sweep_scenarios"]
        self.assertEqual(
            {scenario["family"] for scenario in scenarios},
            {"proposal", "baseline"},
        )
        for scenario in scenarios:
            self.assertGreater(scenario["expected_residue"], 0)
            self.assertGreater(
                scenario["expected_entries"], scenario["reap_batch"]
            )
            self.assertEqual(
                scenario["expected_batches"],
                (
                    scenario["expected_entries"]
                    + scenario["reap_batch"]
                    - 1
                )
                // scenario["reap_batch"],
            )
            self.assertEqual(
                sum(scenario["expected_refunds"].values()),
                scenario["expected_entries"] * 100_000,
            )

    def test_decide_reason_code_matrix(self):
        cases = [
            (
                {"preimage_ok": False},
                RejectReason.CONSTITUTION_VIOLATION,
            ),
            (
                {"resource_locks_held": False},
                RejectReason.RESOURCE_CONFLICT,
            ),
            ({"process_hold": True}, RejectReason.PROCESS_HOLD),
            (
                {
                    "proposal_class": "Treasury",
                    "gate_book_valid": False,
                },
                RejectReason.NOT_DECISION_GRADE,
            ),
            (
                {
                    "proposal_class": "Treasury",
                    "p_adopt": {"Survival": Decimal("0.06")},
                },
                RejectReason.GATE_VETO_SURVIVAL,
            ),
            (
                {
                    "proposal_class": "Treasury",
                    "p_adopt": {"Security": Decimal("0.06")},
                },
                RejectReason.GATE_VETO_SECURITY,
            ),
            (
                {"welfare_grade": Grade.INVALID},
                RejectReason.NOT_DECISION_GRADE,
            ),
            (
                {"accept_full": Decimal("0.54")},
                RejectReason.HURDLE_NOT_MET,
            ),
            ({"converged": False}, RejectReason.CONVERGENCE_FAILED),
            (
                {
                    "accept_trailing": Decimal("0.52"),
                    "extended": True,
                },
                RejectReason.SECOND_EXTENSION_FAILED,
            ),
            (
                {"envelope_value": Decimal("1")},
                RejectReason.SECURITY_SIZING,
            ),
            (
                {
                    "proposal_class": "Code",
                    "attestation_ok": False,
                },
                RejectReason.ATTESTATION_MISSING,
            ),
            ({"queue_time_ok": False}, RejectReason.RATE_LIMITED),
        ]
        base = {
            "accept_full": Decimal("0.56"),
            "reject_full_effective": Decimal("0.50"),
            "delta": Decimal("0.05"),
            "envelope_value": Decimal(0),
        }
        observed = set()
        for overrides, expected in cases:
            result = decide(**(base | overrides))
            self.assertEqual(
                (result.outcome, result.reason),
                (Outcome.REJECT, expected),
            )
            observed.add(expected)
        decide_time = {
            RejectReason.NOT_DECISION_GRADE,
            RejectReason.GATE_VETO_SURVIVAL,
            RejectReason.GATE_VETO_SECURITY,
            RejectReason.HURDLE_NOT_MET,
            RejectReason.CONVERGENCE_FAILED,
            RejectReason.SECOND_EXTENSION_FAILED,
            RejectReason.PROCESS_HOLD,
            RejectReason.CONSTITUTION_VIOLATION,
            RejectReason.RESOURCE_CONFLICT,
            RejectReason.RATE_LIMITED,
            RejectReason.SECURITY_SIZING,
            RejectReason.ATTESTATION_MISSING,
        }
        self.assertEqual(observed, decide_time)
        self.assertEqual(len(RejectReason), 16)

    def test_gate_veto_precedes_welfare_grade_failure(self):
        result = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
            proposal_class="Treasury",
            p_adopt={"Survival": Decimal("0.06")},
            welfare_grade=Grade.INVALID,
        )
        self.assertEqual(result.reason, RejectReason.GATE_VETO_SURVIVAL)

    def test_low_ask_treasury_is_gate_bearing_and_both_vetoes_are_reachable(self):
        for proposal_class in ("Param", "Treasury", "Code", "Meta"):
            with self.subTest(proposal_class=proposal_class):
                self.assertTrue(requires_gate_markets(proposal_class))

        inputs = {
            "accept_full": Decimal("0.56"),
            "reject_full_effective": Decimal("0.50"),
            "delta": Decimal("0.05"),
            "proposal_class": "Treasury",
            "ask": Decimal("100"),
            "spendable_nav": Decimal("7393600"),
        }
        survival = decide(
            **inputs,
            p_adopt={"Survival": Decimal("0.06")},
            p_reject={"Survival": Decimal("0.01")},
        )
        security = decide(
            **inputs,
            p_adopt={"Survival": Decimal("0.01"), "Security": Decimal("0.06")},
            p_reject={"Survival": Decimal("0.01"), "Security": Decimal("0.01")},
        )
        self.assertLessEqual(inputs["ask"], inputs["spendable_nav"] / Decimal(100))
        self.assertEqual(survival.reason, RejectReason.GATE_VETO_SURVIVAL)
        self.assertEqual(security.reason, RejectReason.GATE_VETO_SECURITY)

    def test_param_gate_vetoes_are_reachable_and_honest_param_adopts(self):
        inputs = {
            "accept_full": Decimal("0.517"),
            "reject_full_effective": Decimal("0.500"),
            "accept_trailing": Decimal("0.517"),
            "reject_trailing_effective": Decimal("0.500"),
            "delta": Decimal("0.015"),
            "proposal_class": "Param",
            "envelope_value": Decimal("100"),
            "measured_liquidity": Decimal("1000000"),
        }
        survival = decide(
            **inputs,
            p_adopt={"Survival": Decimal("0.06")},
            p_reject={"Survival": Decimal("0.01")},
        )
        security = decide(
            **inputs,
            p_adopt={"Survival": Decimal("0.01"), "Security": Decimal("0.06")},
            p_reject={"Survival": Decimal("0.01"), "Security": Decimal("0.01")},
        )
        honest = decide(
            **inputs,
            p_adopt={"Survival": Decimal("0.01"), "Security": Decimal("0.01")},
            p_reject={"Survival": Decimal("0.01"), "Security": Decimal("0.01")},
        )
        self.assertEqual(survival.reason, RejectReason.GATE_VETO_SURVIVAL)
        self.assertEqual(security.reason, RejectReason.GATE_VETO_SECURITY)
        self.assertEqual(honest.outcome, Outcome.ADOPT)

    def test_first_insufficiency_extends_second_rejects(self):
        first = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
            welfare_grade=Grade.INSUFFICIENT,
        )
        second = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
            welfare_grade=Grade.INSUFFICIENT,
            extended=True,
        )
        self.assertEqual(first.outcome, Outcome.EXTEND)
        self.assertEqual(
            (second.outcome, second.reason),
            (Outcome.REJECT, RejectReason.NOT_DECISION_GRADE),
        )

    def test_decision_window_match_requires_a_defined_prize_proxy(self):
        split = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
            accept_trailing=Decimal("0.52"),
        )
        self.assertEqual(split.outcome, Outcome.EXTEND)
        adopted = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
            envelope_value=Decimal(0),
        )
        self.assertEqual(adopted.outcome, Outcome.ADOPT)
        undefined = decide(
            Decimal("0.56"),
            Decimal("0.50"),
            Decimal("0.05"),
        )
        self.assertEqual(
            (undefined.outcome, undefined.reason),
            (Outcome.REJECT, RejectReason.SECURITY_SIZING),
        )

    def test_welfare_rounding_and_full_pipeline(self):
        product = Decimal("0.333333333333333333") * Decimal(
            "0.777777777777777777"
        )
        self.assertLessEqual(floor_64x64(product), product)
        geo = weighted_geometric(
            {"b": Decimal("0.7"), "a": Decimal("0.8")},
            {"b": Decimal("0.4"), "a": Decimal("0.6")},
        )
        self.assertTrue(Decimal(0) <= geo <= Decimal(1))
        row = full_pipeline(
            u=Decimal("0.97"),
            f=Decimal("0.96"),
            hhi=Decimal("0.335"),
            phase=2,
            c_onchain={"C01": Decimal("0.94"), "C02": Decimal("0.91")},
            c_attested={"C03": Decimal("0.90")},
            c_weights={
                "C01": Decimal("0.50"),
                "C02": Decimal("0.30"),
                "C03": Decimal("0.20"),
            },
            incident=Decimal("0.98"),
            p_components={"P01": Decimal("0.8"), "P02": Decimal("0.7")},
            p_weights={"P01": Decimal("0.6"), "P02": Decimal("0.4")},
            a_components={"A01": Decimal("0.9"), "A02": Decimal("0.6")},
            a_weights={"A01": Decimal("0.4"), "A02": Decimal("0.6")},
            c_daily={"C01": Decimal("0.93"), "C02": Decimal("0.89")},
        )
        self.assertEqual(row["S"], Decimal("0.831250000"))
        self.assertTrue(Decimal(0) <= row["W"] <= Decimal(1))
        self.assertNotEqual(row["C"], row["C_daily"])
        # 05 §4.4(4): the score is idempotent on on-grid values at or above
        # the eps_W floor; below it the floor binds, so a doubly-zeroed pair
        # scores exactly eps_W (one base unit), never 0.
        self.assertEqual(
            settlement_score(row["W"], row["W"]),
            max(row["W"], Decimal("1e-9")),
        )
        self.assertEqual(
            settlement_score(Decimal("0.123456789"), Decimal("0.123456789")),
            Decimal("0.123456789"),
        )

    def test_welfare_gate_and_settlement_vectors(self):
        self.assertEqual(
            gate(Decimal("0.85"), Decimal("0.85"), Decimal("0.95")),
            Decimal("0E-9"),
        )
        self.assertEqual(
            gate(Decimal("0.95"), Decimal("0.85"), Decimal("0.95")),
            Decimal(1),
        )
        self.assertEqual(
            settlement_score(Decimal("0.8"), Decimal("0.8")),
            Decimal("0.800000000"),
        )
        self.assertEqual(
            settlement_score(Decimal("0.64"), Decimal("0.25")),
            Decimal("0.400000000"),
        )
        self.assertEqual(collator_d_eff(Decimal("0.2"), 2), Decimal("1.000000000"))
        self.assertEqual(
            collator_d_eff(Decimal("0.335"), 2), Decimal("0.831250000")
        )

    def test_normalization_cold_start_and_percentiles(self):
        sample = [Decimal(i) for i in range(12)]
        self.assertEqual(percentile(sample, Decimal("0.05")), Decimal("0.55"))
        self.assertEqual(
            percentile(sample, Decimal("0.95")), Decimal("10.45")
        )
        trailing = normalization_sample(sample, [Decimal(12), Decimal(13)])
        self.assertEqual(trailing, [Decimal(i) for i in range(2, 14)])
        self.assertEqual(
            normalize_metric(Decimal("6"), sample, []),
            Decimal("0.550505050"),
        )
        logged = normalize_metric(Decimal("6"), sample, [], log1p=True)
        self.assertTrue(Decimal(0) < logged < Decimal(1))

    def test_daily_c_renormalization_uses_the_q64_quotient_before_products(self):
        composite = weighted_geometric(
            {"C01": Decimal("0.531441"), "C02": Decimal("1.0")},
            {"C01": Decimal("0.1"), "C02": Decimal("0.5")},
            renormalize=True,
        )
        self.assertEqual(composite, Decimal("0.900000000"))

    def test_nav_and_security_rounding_directions(self):
        healthy = nav(
            Decimal("100"),
            undisbursed_reversions=Decimal("5"),
            obligations=Decimal("25"),
        )
        impaired = nav(
            Decimal("100"),
            obligations=Decimal("25"),
            reserve_impaired=True,
        )
        self.assertEqual(healthy.nav, Decimal("80"))
        self.assertEqual(healthy.spendable_nav, Decimal("80"))
        self.assertEqual(impaired.nav, Decimal("75"))
        self.assertEqual(impaired.spendable_nav, Decimal("0"))
        self.assertIsNone(in_cap_prize("Param"))
        self.assertEqual(
            in_cap_prize("Param", envelope=Decimal(0)),
            Decimal("0.000000"),
        )
        self.assertEqual(
            in_cap_prize("Param", envelope=Decimal("1.0000001")),
            Decimal("1.000001"),
        )
        self.assertEqual(
            attack_cost_hat(Decimal("2.000001")),
            Decimal("3.000001"),
        )
        self.assertTrue(
            security_sizing_ok(Decimal("1"), Decimal("3"))
        )
        self.assertFalse(
            security_sizing_ok(Decimal("1.000001"), Decimal("3"))
        )

    def test_code_meta_nav_floor_is_scoped_to_upgrade_payloads(self):
        inputs = {
            "ask": Decimal("100"),
            "envelope": Decimal("200"),
            "spendable_nav": Decimal("10000"),
        }
        for proposal_class in ("Code", "Meta"):
            with self.subTest(proposal_class=proposal_class):
                self.assertEqual(
                    in_cap_prize(proposal_class, **inputs),
                    Decimal("500.000000"),
                )
                self.assertEqual(
                    in_cap_prize(
                        proposal_class,
                        **inputs,
                        upgrade_payload=False,
                    ),
                    Decimal("200.000000"),
                )

    def test_pol_commitments_and_nav_floor_worked_numbers(self):
        commitment_cases = [
            ("Param", 34_657),
            ("Treasury", 55_452),
            ("Code", 103_972),
            ("Meta", 159_424),
        ]
        for proposal_class, displayed in commitment_cases:
            model = display_integer(pol_commitment(proposal_class))
            self.assertEqual(model, displayed)
        self.assertEqual(display_integer(baseline_commitment()), 17_329)

        floor_cases = [
            (("Param", 1), 4_620_989),
            (("Treasury", 1), 7_393_600),
            (("Code", 1), 13_862_944),
            (("Meta", 1), 21_256_533),
            (("Param", 5), 23_104_906),
            (("Meta", 5), 106_282_533),
        ]
        for (proposal_class, slots), displayed in floor_cases:
            model = nav_floor(proposal_class, slots=slots)
            self.assertLessEqual(abs(model - displayed), Decimal(10))

    def test_security_worked_numbers_and_scaling(self):
        nav_value = Decimal("13862944")
        prize = in_cap_prize(
            "Code", envelope=Decimal(0), spendable_nav=nav_value
        )
        volume = dec_v_min("Code", prize)
        depth = Decimal(2) * Decimal("60000") * lmsr.LN2
        liquidity = depth + volume
        attack = attack_cost_hat(liquidity)
        displayed = [
            (prize, 693_147),
            (volume, 1_386_294),
            (depth, 83_178),
            (liquidity, 1_469_472),
            (attack, 2_204_208),
            (Decimal(3) * prize, 2_079_441),
            (attack / Decimal(3), 734_736),
        ]
        for model, expected in displayed:
            self.assertLessEqual(
                abs(
                    int(
                        model.to_integral_value(
                            rounding=ROUND_HALF_UP
                        )
                    )
                    - expected
                ),
                10,
            )
        treasury_liquidity = (
            Decimal(2) * Decimal("25000") * lmsr.LN2
            + Decimal("400000")
        )
        self.assertLessEqual(
            abs(display_integer(attack_cost_hat(treasury_liquidity)) - 651_986),
            10,
        )
        p_refs = {
            "Param": 56_931,  # 08 §5.4 reconciled (SQ-29): pair depth 13,863, not 27,726
            "Treasury": 142_329,
            "Code": 341_589,
            "Meta": 669_315,
        }
        for proposal_class, expected in p_refs.items():
            self.assertEqual(display_integer(p_ref(proposal_class)), expected)
        self.assertEqual(
            dec_v_min("Treasury", Decimal("200000")),
            Decimal("400000"),
        )
        self.assertGreater(pol_b("Code", Decimal("700000")), Decimal("60000"))
        self.assertLessEqual(
            decision_delta("Meta", Decimal("999999999")),
            Decimal("0.10"),
        )

    def test_imports_do_not_mutate_global_decimal_context(self):
        # The package was imported at module load; if any module had set
        # getcontext().prec at import time (the audited defect), the ambient
        # context would no longer be the Python default of 28. Reloading is
        # deliberately avoided: it would recreate exception/enum classes and
        # break identity comparisons for the rest of the suite.
        self.assertEqual(getcontext().prec, 28)


class ContestCapitalTests(unittest.TestCase):
    """04 §7a / 05 §5.2 / 08 §5.2 SQ-231 contest-capital semantics."""

    def test_wash_round_trip_inside_one_interval_is_zero(self):
        # A buy at block 3 unwound at block 7 restores q exactly (LMSR path
        # independence); every recorded observation samples the previous
        # block's stored state, which is flat — zero contest capital.
        accumulator = ContestCapitalAccumulator()
        for block in (10, 20):
            noi = accumulator.observe(block, "0", "0", "0.5")
            self.assertEqual(noi, Decimal(0))
        self.assertEqual(accumulator.mean(0, 20), Decimal(0))
        # The same exposure held instead of unwound accrues.
        held = ContestCapitalAccumulator()
        self.assertGreater(held.observe(10, "1000", "0", "0.5"), Decimal(0))

    def test_held_exposure_accrues_time_times_marked_value(self):
        accumulator = ContestCapitalAccumulator()
        accumulator.observe(10, "1000", "0", "0.5")
        accumulator.observe(20, "1000", "0", "0.5")
        # noi = 1000 * 0.5 = 500, backward-weighted over each interval.
        self.assertEqual(accumulator.mean(0, 20), Decimal(500))
        # Twice the holding time doubles N; twice the position doubles noi.
        accumulator.observe(30, "1000", "0", "0.5")
        accumulator.observe(40, "1000", "0", "0.5")
        self.assertEqual(
            accumulator.cumulative_at(40),
            Decimal(2) * accumulator.cumulative_at(20),
        )
        doubled = ContestCapitalAccumulator()
        self.assertEqual(
            doubled.observe(10, "2000", "0", "0.5"), Decimal(1000)
        )
        # Exposure held only through the second half of the window
        # contributes exactly half the window mean.
        late = ContestCapitalAccumulator()
        late.observe(10, "0", "0", "0.5")
        late.observe(20, "1000", "0", "0.5")
        self.assertEqual(late.mean(0, 20), Decimal(250))
        # Both sides mark at their own price; N is monotone non-decreasing.
        both = ContestCapitalAccumulator()
        self.assertEqual(
            both.observe(10, "1000", "500", "0.6"),
            Decimal(600) + Decimal(200),
        )
        cumulatives = [point.cumulative for point in accumulator.points]
        self.assertEqual(cumulatives, sorted(cumulatives))

    def test_pol_seeded_positions_are_excluded(self):
        accumulator = ContestCapitalAccumulator(
            q_pol_long="1000", q_pol_short="1000"
        )
        self.assertEqual(
            accumulator.observe(10, "1000", "1000", "0.5"), Decimal(0)
        )
        # Only the net trader exposure above the recorded POL position marks.
        self.assertEqual(
            accumulator.observe(20, "1500", "1000", "0.5"), Decimal(250)
        )
        # A trader-side deficit below POL never goes negative (max(., 0)).
        self.assertEqual(
            accumulator.observe(30, "400", "1000", "0.5"), Decimal(0)
        )

    def test_noi_rounds_down_on_the_base_unit_grid(self):
        self.assertEqual(
            marked_open_interest("1", "0", "0.1234567"),
            Decimal("0.123456"),
        )
        with self.assertRaises(ValueError):
            marked_open_interest("1", "0", "1.5")

    def test_l_hat_flow_cap_ceiling_binds(self):
        pol_depth = Decimal(2) * Decimal(25000) * lmsr.LN2
        # flow_cap = 8: at the floor b = 25,000 the ×7 kernel minimum would sit
        # below 2P/(b_acc+b_rej) = 8 for this 08 §5.4(b) proposal — the §5.3
        # non-bindingness argument assumes the scaled pol.b; the calibrated
        # flow_cap sits above the minimum.
        organic = l_hat(pol_depth, "400000", "8", "25000", "25000")
        self.assertEqual(organic - pol_depth, Decimal(400000))
        # Contest capital beyond flow_cap*(b_acc+b_rej) is capped at 350,000:
        # wash inflation of the certificate is bounded by the ceiling.
        capped = l_hat(pol_depth, "1000000000", "7", "25000", "25000")
        self.assertEqual(capped - pol_depth, Decimal(350000))
        # The 08 §5.4(b) treasury example stays intact through the new form.
        self.assertLessEqual(
            abs(display_integer(attack_cost_hat(organic)) - 651_986), 10
        )
        # And the capped L-hat fails the same proposal's sizing: 3P = 600,000.
        self.assertFalse(
            security_sizing_ok(Decimal(200000), attack_cost_hat(capped))
        )
        with self.assertRaises(ValueError):
            l_hat(pol_depth, "400000", "6.999", "25000", "25000")
        with self.assertRaises(ValueError):
            manip_floor_hat(
                [(Decimal(25000), Decimal("0.5"))],
                Decimal("0.025"),
                Decimal(400000),
                Decimal(5),
            )

    def test_manip_floor_hat_is_cash_cost_and_matches_the_simulation(self):
        """05 §5.6 / SQ-562: `C_disp` is 04 §3's `cost`, never its `Delta`.

        Two assertions, and the second is the one that lasts. First: at
        Bleavit's own PARAM pair the diagnostic reads the cash figure, not the
        share figure it used to read. Second: the reference model and the
        Phase-0 simulation compute the same number — they disagreed by 1.928x
        for as long as nothing compared them.
        """
        b = Decimal(10000)
        p_bar = Decimal("0.5")
        delta = Decimal("0.0375")  # 13 §1 dec.sigma / DELTA[PARAM].

        # C_hold = 0 isolates C_disp: contest capital is zero at registration.
        floor_ = manip_floor_hat(
            [(b, p_bar), (b, p_bar)], delta, Decimal(0), Decimal(16)
        )
        # The cash cost of two delta-moves, from 04 §3's `cost = b*ln((1-p)/(1-p'))`.
        expected = treasury.round_down(
            Decimal(2) * lmsr.displacement_cost(b, p_bar, p_bar + delta)
        )
        self.assertEqual(floor_, expected)
        self.assertEqual(floor_, Decimal("1559.230829"))

        # The superseded expression — 04 §3's *displacement*, a share count —
        # read 1.928x high, and high is the unsafe direction for a lower bound:
        # 05 §5.6's escape clause fires when the floor reads *below*
        # `3 * InCapPrize`, so overstating it delays the trigger.
        superseded = Decimal(2) * b * (
            ((p_bar + delta) * (1 - p_bar)) / ((1 - p_bar - delta) * p_bar)
        ).ln()
        self.assertGreater(superseded, floor_ * Decimal("1.9"))

        # The simulation's own implementation, reproduced here rather than
        # imported (`simulation/` is a separate package and not on this suite's
        # path): accept book displaced up, reject book displaced down, both
        # priced with the same cash formula.
        accept_leg = lmsr.displacement_cost(b, p_bar, p_bar + delta)
        reject_leg = lmsr.displacement_cost(
            b, Decimal(1) - p_bar, Decimal(1) - (p_bar - delta)
        )
        self.assertEqual(treasury.round_down(accept_leg + reject_leg), floor_)

    def test_decide_decomposed_l_hat_matches_composed(self):
        kwargs = dict(
            accept_full=Decimal("0.56"),
            reject_full_effective=Decimal("0.50"),
            delta=Decimal("0.05"),
            proposal_class="Treasury",
            ask=Decimal(200000),
        )
        pol_depth = Decimal(2) * Decimal(25000) * lmsr.LN2
        composed = decide(
            measured_liquidity=pol_depth + Decimal(400000), **kwargs
        )
        decomposed = decide(
            pol_depth=pol_depth,
            contest_accept=Decimal(400000),
            contest_reject=Decimal(400000),
            flow_cap=Decimal(8),
            b_accept=Decimal(25000),
            b_reject=Decimal(25000),
            **kwargs,
        )
        self.assertEqual(composed, decomposed)
        self.assertIs(composed.outcome, Outcome.ADOPT)
        asymmetric = decide(
            pol_depth=pol_depth,
            contest_accept=Decimal(400000),
            contest_reject=Decimal(100000),
            flow_cap=Decimal(8),
            b_accept=Decimal(25000),
            b_reject=Decimal(25000),
            **kwargs,
        )
        self.assertIs(asymmetric.outcome, Outcome.REJECT)
        self.assertIs(asymmetric.reason, RejectReason.SECURITY_SIZING)
        with self.assertRaises(ValueError):
            decide(pol_depth=pol_depth, **kwargs)

    def test_grading_fails_closed_on_contest_capital_not_gross_notional(self):
        # The SQ-231 scenario: an attacker churns 1M USDC of gross notional
        # through the book in round trips that never survive an observation.
        b = Decimal(10000)
        gross_notional = Decimal(0)
        accumulator = ContestCapitalAccumulator()
        block = 10
        for _ in range(50):
            gross_notional += buy_delta_cost(b, 0, 0, "long", 10000)
            gross_notional += lmsr.sell_delta_proceeds(
                b, 10000, 0, "long", 10000
            )
            accumulator.observe(block, "0", "0", "0.5")
            block += 10
        v_min = dec_v_min("Param", Decimal(0))
        self.assertGreaterEqual(gross_notional, v_min)  # old measure passed
        contest = accumulator.mean(0, block - 10)
        self.assertEqual(contest, Decimal(0))  # new measure does not
        grade = grade_welfare_book(
            twap=Decimal("0.5"),
            spot_close=Decimal("0.5"),
            coverage=Decimal(1),
            stale_events=0,
            pol_floor_met=True,
            pol_undisturbed=True,
            contest_capital=contest,
            v_min=v_min,
        )
        self.assertIs(grade, Grade.INSUFFICIENT)
        first = decide(
            accept_full=Decimal("0.56"),
            reject_full_effective=Decimal("0.50"),
            delta=Decimal("0.05"),
            welfare_grade=grade,
        )
        self.assertIs(first.outcome, Outcome.EXTEND)
        recurred = decide(
            accept_full=Decimal("0.56"),
            reject_full_effective=Decimal("0.50"),
            delta=Decimal("0.05"),
            welfare_grade=grade,
            extended=True,
        )
        self.assertEqual(
            recurred,
            type(recurred)(Outcome.REJECT, RejectReason.NOT_DECISION_GRADE),
        )
        # Genuinely held contest capital at the floor grades OK.
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"),
                spot_close=Decimal("0.5"),
                coverage=Decimal(1),
                stale_events=0,
                pol_floor_met=True,
                pol_undisturbed=True,
                contest_capital=v_min,
                v_min=v_min,
            ),
            Grade.OK,
        )

    def test_welfare_book_grade_partitions(self):
        base = dict(
            spot_close=Decimal("0.5"),
            coverage=Decimal(1),
            stale_events=0,
            pol_floor_met=True,
            pol_undisturbed=True,
            contest_capital=Decimal(100000),
            v_min=Decimal(100000),
        )
        self.assertIs(
            grade_welfare_book(twap=Decimal("0.5"), **base), Grade.OK
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.01"),
                **{**base, "spot_close": Decimal("0.01")},
            ),
            Grade.INVALID,  # sanity band (welfare books only)
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"), **{**base, "pol_undisturbed": False}
            ),
            Grade.INVALID,
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"), **{**base, "stale_events": 1}
            ),
            Grade.INSUFFICIENT,  # 04 §7: first stale event extends once
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"), **{**base, "stale_events": 2}
            ),
            Grade.INVALID,  # second forces reject (status-quo default)
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"), **{**base, "coverage": Decimal("0.94")}
            ),
            Grade.INSUFFICIENT,
        )
        self.assertIs(
            grade_welfare_book(
                twap=Decimal("0.5"), **{**base, "spot_close": Decimal("0.56")}
            ),
            Grade.INVALID,  # |spot_close - TWAP| > 0.05
        )

    def test_gate_book_near_boundary_rule(self):
        base = dict(
            twap=Decimal("0.005"),
            spot_close=Decimal("0.006"),
            coverage=Decimal("0.99"),
            stale_events=0,
            pol_floor_met=True,
            pol_undisturbed=True,
            contest_capital=Decimal(10000),
            gate_v_min=Decimal(10000),  # 0.1 * dec.v_min(Param)
        )
        self.assertTrue(gate_decision_grade(**base))
        self.assertFalse(
            gate_decision_grade(**{**base, "coverage": Decimal("0.97")})
        )
        self.assertFalse(gate_decision_grade(**{**base, "stale_events": 1}))
        self.assertFalse(
            gate_decision_grade(**{**base, "spot_close": Decimal("0.02")})
        )
        # The contest floor is graded over the same measure in both regimes.
        self.assertFalse(
            gate_decision_grade(
                **{**base, "contest_capital": Decimal("9999.999999")}
            )
        )
        # Inside the band the welfare-book validity checks apply instead.
        in_band = {
            **base,
            "twap": Decimal("0.5"),
            "spot_close": Decimal("0.52"),
            "coverage": Decimal("0.96"),
        }
        self.assertTrue(gate_decision_grade(**in_band))
        self.assertFalse(
            gate_decision_grade(**{**in_band, "pol_undisturbed": False})
        )


def _fixture():
    return json.loads(
        (
            Path(__file__).resolve().parents[1] / "fixtures" / "vectors.json"
        ).read_text()
    )


def _settled_scalar_vault(rate=0, escrow=20_000, score="0.70005", **kwargs):
    vault = Vault(redeem_fee=rate, **kwargs)
    vault.split(escrow)
    vault.split_scalar(Branch.ACCEPT, escrow)
    vault.resolve(Branch.ACCEPT)
    vault.settle_scalar(Decimal(score))
    return vault


def _settled_baseline_vault(rate=0, escrow=2_000_000, score="0.70005"):
    baseline = BaselineVault(epoch=7, redeem_fee=rate)
    baseline.split_baseline(escrow)
    baseline.settle_baseline(Decimal(score))
    return baseline


class RedemptionFeeTests(unittest.TestCase):
    """03 §5.3a redemption fee, §5.4 sweep, §6.5 closing paragraph."""

    RATE = DEFAULT_REDEEM_FEE_PERBILL  # 30 bps

    # -- §5.3a(2) arithmetic -------------------------------------------------

    def test_fee_rounds_up_and_the_waiver_tests_the_net(self):
        # ceil, not floor: the fee rounds against the claimant and in favour
        # of the protocol, matching 03 §7 R-1's direction.
        self.assertEqual((14_001 * self.RATE) // PERBILL_ONE, 42)
        self.assertEqual(redemption_fee(14_001, self.RATE), 43)
        # §5.3a(2): the waiver predicate is `g − ceil(g·rate) < min_split`.
        # 10_030 is the last waived gross; 10_031 is the first charged one and
        # nets exactly `min_split`.
        self.assertEqual(redemption_fee(10_030, self.RATE), 0)
        self.assertEqual(redemption_fee(10_031, self.RATE), 31)
        self.assertEqual(10_031 - 31, MIN_SPLIT)
        # The waived set is a prefix interval: the predicate is monotone in g.
        charged = [
            g for g in range(0, 30_000) if redemption_fee(g, self.RATE)
        ]
        self.assertEqual(charged, list(range(10_031, 30_000)))
        # A zero gross (losing gate side) is waived by the same rule.
        self.assertEqual(redemption_fee(0, self.RATE), 0)
        # A zero rate is a zero fee at every size, waived branch or not.
        self.assertEqual(redemption_fee(10 ** 12, 0), 0)
        self.assertEqual(redemption_fee(1, 0), 0)

    def test_fee_never_exceeds_the_gross_at_any_admissible_rate(self):
        # §5.3a(2)/I-32(a): `fee(g) ≤ g`, so no net payout can go negative.
        for rate in (0, 1, self.RATE, 500_000_000, PERBILL_ONE):
            for gross in (0, 1, MIN_SPLIT - 1, MIN_SPLIT, 14_001, 10 ** 9):
                fee = redemption_fee(gross, rate)
                self.assertGreaterEqual(fee, 0)
                self.assertLessEqual(fee, gross)

    def test_rate_read_fails_open_on_a_malformed_record(self):
        # §5.3a(5)/I-32(d): a missing, malformed or out-of-domain record reads
        # as ZERO. This is the one place the ledger's fail-open direction is
        # correct, because it is the claimant-favouring one.
        for bad in (None, "3000000", -1, PERBILL_ONE + 1, True, 1.5):
            self.assertEqual(effective_redeem_fee(bad), 0)
            self.assertEqual(redemption_fee(1_000_000, bad), 0)
        self.assertEqual(effective_redeem_fee(PERBILL_ONE), PERBILL_ONE)
        self.assertEqual(effective_redeem_fee(self.RATE), self.RATE)

    # -- §5.3a(1) charged calls ---------------------------------------------

    def test_redeem_scalar_is_charged_and_escrow_falls_by_the_gross(self):
        vault = _settled_scalar_vault(self.RATE)
        before = vault.escrowed
        net = vault.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, 20_000)
        self.assertEqual(net, 13_958)
        self.assertEqual(vault.redemption_fees_accrued, 43)
        # §5.3a(4): escrow decrements by the GROSS, always — never the net,
        # and never a second time for the fee.
        self.assertEqual(before - vault.escrowed, 14_001)
        self.assertEqual(net + vault.redemption_fees_accrued, 14_001)
        vault.check_conservation()

    def test_redeem_scalar_pair_charges_its_legs_not_its_gross(self):
        # §5.3a(2a): `fee_pair(a) = fee(floor(a·s)) + fee(floor(a·(1−s)))`.
        # Here that is fee(14_001) + fee(5_999) = 43 + 0, NOT fee(20_000) = 60.
        vault = _settled_scalar_vault(self.RATE)
        before = vault.escrowed
        self.assertEqual(
            vault.redeem_scalar_pair(Branch.ACCEPT, 20_000), 19_957
        )
        self.assertEqual(vault.redemption_fees_accrued, 43)
        self.assertEqual(
            redemption_fee_pair(20_000, Decimal("0.70005"), self.RATE), 43
        )
        self.assertEqual(redemption_fee(20_000, self.RATE), 60)
        # The gross is still exactly `a`; only the fee base changed.
        self.assertEqual(before - vault.escrowed, 20_000)

    def test_redeem_gate_is_charged_on_the_winning_side_only(self):
        vault = Vault(redeem_fee=self.RATE)
        vault.split(1_000_000)
        vault.split_gate(Branch.ACCEPT, GateType.SURVIVAL, 1_000_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_gate(GateType.SURVIVAL, True)
        vault.settle_scalar(Decimal("0.5"))
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT, GateType.SURVIVAL, GateSide.YES, 500_000
            ),
            498_500,
        )
        self.assertEqual(vault.redemption_fees_accrued, 1_500)
        # The losing side pays a zero gross, so it is waived, not charged.
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT, GateType.SURVIVAL, GateSide.NO, 500_000
            ),
            0,
        )
        self.assertEqual(vault.redemption_fees_accrued, 1_500)
        vault.check_conservation()

    def test_baseline_legs_are_charged(self):
        baseline = _settled_baseline_vault(self.RATE)
        self.assertEqual(
            baseline.redeem_baseline(ScalarSide.LONG, 1_000_000), 697_949
        )
        self.assertEqual(baseline.redemption_fees_accrued, 2_101)
        # §5.3a(2a) again: fee(700_050) + fee(299_950) = 2101 + 900 = 3001,
        # not fee(1_000_000) = 3000.
        self.assertEqual(baseline.redeem_baseline_pair(1_000_000), 996_999)
        self.assertEqual(baseline.redemption_fees_accrued, 5_102)
        baseline.check_conservation()

    # -- §5.3a(1) exemptions -------------------------------------------------

    def test_par_leg_redeem_is_exempt(self):
        # G-3/I-5: winning branch-USDC redeems 1:1 verbatim at any rate.
        vault = Vault(redeem_fee=self.RATE)
        vault.split(1_000_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_scalar(Decimal("0.5"))
        self.assertEqual(vault.redeem(Branch.ACCEPT, 1_000_000), 1_000_000)
        self.assertEqual(vault.redemption_fees_accrued, 0)
        self.assertEqual(vault.fees_charged_total, 0)

    def test_redeem_void_is_exempt(self):
        # D-1/I-26: VOID is protocol failure; the schedule is unmoved.
        vault = Vault(redeem_fee=self.RATE)
        vault.split(1_000_000)
        vault.split_scalar(Branch.ACCEPT, 400_000)
        vault.void()
        self.assertEqual(
            vault.redeem_void(
                Branch.REJECT, PositionKind.BRANCH_USDC, 1_000_000
            ),
            500_000,
        )
        self.assertEqual(
            vault.redeem_void(Branch.ACCEPT, PositionKind.LONG, 400_000),
            100_000,
        )
        self.assertEqual(vault.fees_charged_total, 0)

    def test_every_merge_primitive_is_exempt(self):
        vault = Vault(redeem_fee=self.RATE)
        vault.split(1_000_000)
        vault.split_scalar(Branch.ACCEPT, 400_000)
        vault.split_gate(Branch.REJECT, GateType.SECURITY, 400_000)
        # `merge_scalar`/`merge_gate` pay no USDC at all — value moves inside
        # the vault — so there is nothing for a fee to attach to.
        vault.merge_scalar(Branch.ACCEPT, 400_000)
        vault.merge_gate(Branch.REJECT, GateType.SECURITY, 400_000)
        self.assertEqual(vault.total_payouts, 0)
        # `merge` pays par, and stays par.
        self.assertEqual(vault.merge(1_000_000), 1_000_000)
        self.assertEqual(vault.fees_charged_total, 0)

        baseline = BaselineVault(epoch=7, redeem_fee=self.RATE)
        baseline.split_baseline(1_000_000)
        self.assertEqual(baseline.merge_baseline(1_000_000), 1_000_000)
        self.assertEqual(baseline.fees_charged_total, 0)

    def test_sweep_dust_residue_is_not_a_settlement_payout(self):
        vault = _settled_scalar_vault(self.RATE)
        residue = vault.sweep_dust()
        self.assertEqual(residue, 20_000)
        self.assertEqual(vault.fees_charged_total, 0)

    def test_protocol_account_claimants_are_exempt(self):
        # §5.3a(1): charging them would be the treasury taxing itself.
        charged = _settled_scalar_vault(self.RATE)
        exempt = _settled_scalar_vault(self.RATE)
        self.assertEqual(
            charged.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, 20_000),
            13_958,
        )
        self.assertEqual(
            exempt.redeem_scalar(
                Branch.ACCEPT,
                ScalarSide.LONG,
                20_000,
                protocol_account=True,
            ),
            14_001,
        )
        self.assertEqual(exempt.fees_charged_total, 0)

        pair = _settled_scalar_vault(self.RATE)
        self.assertEqual(
            pair.redeem_scalar_pair(
                Branch.ACCEPT, 20_000, protocol_account=True
            ),
            20_000,
        )
        self.assertEqual(pair.fees_charged_total, 0)

        baseline = _settled_baseline_vault(self.RATE)
        self.assertEqual(
            baseline.redeem_baseline(
                ScalarSide.LONG, 1_000_000, protocol_account=True
            ),
            700_050,
        )
        self.assertEqual(
            baseline.redeem_baseline_pair(
                1_000_000, protocol_account=True
            ),
            1_000_000,
        )
        self.assertEqual(baseline.fees_charged_total, 0)

    # -- structural: the exemption cannot be lost to an edit -----------------

    def test_the_shared_payout_seam_never_guesses_a_fee_treatment(self):
        # The chargeability is passed at every call site, never inferred, so
        # `redeem`/`redeem_void` cannot acquire a fee by a later edit here.
        vault = _settled_scalar_vault(self.RATE)
        with self.assertRaises(TypeError):
            vault._terminal_pay(1_000)
        with self.assertRaises(ValueError):
            vault._terminal_pay(1_000, "charged")
        with self.assertRaises(ValueError):
            vault._pay_out(1_000, True)
        self.assertFalse(FeeTreatment.EXEMPT_PAR_LEG.charged)
        self.assertFalse(FeeTreatment.EXEMPT_VOID.charged)
        self.assertTrue(FeeTreatment.CHARGED.charged)

    # -- §6.5 closing paragraph / I-31 --------------------------------------

    def test_net_plus_fee_equals_gross_for_every_charged_call(self):
        for rate in (0, 1, self.RATE, 500_000_000, PERBILL_ONE):
            for call in ("long", "short", "pair", "gate"):
                vault = _settled_scalar_vault(rate, escrow=1_000_000)
                if call == "gate":
                    vault = Vault(redeem_fee=rate)
                    vault.split(1_000_000)
                    vault.split_gate(
                        Branch.ACCEPT, GateType.SURVIVAL, 1_000_000
                    )
                    vault.resolve(Branch.ACCEPT)
                    vault.settle_gate(GateType.SURVIVAL, True)
                    vault.settle_scalar(Decimal("0.5"))
                before_escrow = vault.escrowed
                before_fees = vault.fees_charged_total
                if call == "long":
                    net = vault.redeem_scalar(
                        Branch.ACCEPT, ScalarSide.LONG, 1_000_000
                    )
                elif call == "short":
                    net = vault.redeem_scalar(
                        Branch.ACCEPT, ScalarSide.SHORT, 1_000_000
                    )
                elif call == "pair":
                    net = vault.redeem_scalar_pair(Branch.ACCEPT, 1_000_000)
                else:
                    net = vault.redeem_gate(
                        Branch.ACCEPT,
                        GateType.SURVIVAL,
                        GateSide.YES,
                        1_000_000,
                    )
                gross = before_escrow - vault.escrowed
                fee = vault.fees_charged_total - before_fees
                self.assertEqual(net + fee, gross, (rate, call))
                expected = (
                    redemption_fee_pair(1_000_000, vault.s, rate)
                    if call == "pair"
                    else redemption_fee(gross, rate)
                )
                self.assertEqual(fee, expected, (rate, call))
                vault.check_conservation()

    def test_conservation_checks_the_counter_and_the_custody_surplus(self):
        vault = _settled_scalar_vault(self.RATE)
        vault.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, 20_000)
        vault.check_conservation()
        # Each of the three §6.5 obligations is load-bearing: break one and
        # the check must fail rather than pass quietly.
        broken = copy.deepcopy(vault)
        broken.net_payouts += 1  # net + fee != gross
        with self.assertRaises(AssertionError):
            broken.check_conservation()
        broken = copy.deepcopy(vault)
        broken.redemption_fees_accrued -= 1  # counter not sweep-exact
        with self.assertRaises(AssertionError):
            broken.check_conservation()
        broken = copy.deepcopy(vault)
        # Drawing the fee out of custody a SECOND time — paying the claimant
        # the net AND forwarding the fee inside the redemption — is the
        # failure mode §5.3a(4) exists to forbid. `sovereign` follows the real
        # transfers, so the custody identity is what catches it.
        broken.sovereign -= 43
        with self.assertRaises(AssertionError):
            broken.check_conservation()
        # And the retained fee is exactly the L-2 surplus, never more.
        self.assertEqual(
            vault.sovereign - vault.escrowed, vault.redemption_fees_accrued
        )

    def test_sweep_zeroes_the_counter_and_touches_nothing_else(self):
        vault = _settled_scalar_vault(self.RATE)
        vault.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, 20_000)
        self.assertEqual(vault.redemption_fees_accrued, 43)
        escrow = vault.escrowed
        supplies = copy.deepcopy(vault.branches)
        payouts = vault.total_payouts
        self.assertEqual(vault.sweep_redemption_fees(), 43)
        self.assertEqual(vault.redemption_fees_accrued, 0)
        self.assertEqual(vault.fees_swept_total, 43)
        self.assertEqual(vault.escrowed, escrow)
        self.assertEqual(vault.branches, supplies)
        self.assertEqual(vault.total_payouts, payouts)
        self.assertEqual(vault.state, VaultState.SCALAR_SETTLED)
        # A sweep on an empty counter is a no-op (I-31, §6.5(3)). §5.3a(6)
        # adds no new error and the §8 list is frozen, so it cannot fail.
        self.assertEqual(vault.sweep_redemption_fees(), 0)
        self.assertEqual(vault.fees_swept_total, 43)
        vault.check_conservation()

    def test_counter_is_monotone_between_sweeps(self):
        vault = _settled_scalar_vault(self.RATE, escrow=1_000_000)
        seen = [vault.redemption_fees_accrued]
        for amount in (100_000, 200_000, 300_000):
            vault.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, amount)
            seen.append(vault.redemption_fees_accrued)
        self.assertEqual(seen, sorted(seen))
        self.assertGreater(seen[-1], seen[0])
        self.assertEqual(
            vault.sweep_redemption_fees(), vault.fees_charged_total
        )
        self.assertEqual(vault.redemption_fees_accrued, 0)
        vault.redeem_scalar(Branch.ACCEPT, ScalarSide.LONG, 100_000)
        self.assertGreater(vault.redemption_fees_accrued, 0)
        vault.check_conservation()

    # -- 15 §4.3 rate coverage: the zero-rate regression ---------------------

    def test_zero_rate_model_reproduces_the_pre_change_corpus_exactly(self):
        # The committed rows were generated before the fee existed and are
        # byte-unchanged by it. Replaying them through a default-constructed
        # model is therefore the pre-E1 regression 15 §4.3 makes normative:
        # any leakage of a non-zero default into any call site fails here.
        fixture = _fixture()
        for row in fixture["ledger_score_scenarios"]:
            score = Decimal(row["score"]) / Decimal(PERBILL_ONE)
            amount = row["amount"]
            for side, expected in (
                (ScalarSide.LONG, row["long_payout"]),
                (ScalarSide.SHORT, row["short_payout"]),
            ):
                vault = Vault()
                vault.split(amount)
                vault.split_scalar(Branch.ACCEPT, amount)
                vault.resolve(Branch.ACCEPT)
                vault.settle_scalar(score)
                self.assertEqual(
                    vault.redeem_scalar(Branch.ACCEPT, side, amount),
                    expected,
                    row["name"],
                )
                self.assertEqual(vault.fees_charged_total, 0)
            vault = Vault()
            vault.split(amount)
            vault.split_scalar(Branch.ACCEPT, amount)
            vault.resolve(Branch.ACCEPT)
            vault.settle_scalar(score)
            self.assertEqual(
                vault.redeem_scalar_pair(Branch.ACCEPT, amount),
                row["pair_payout"],
                row["name"],
            )
            self.assertEqual(vault.fees_charged_total, 0)

        rows = {row["name"]: row for row in fixture["ledger_scenarios"]}
        self.assertEqual(len(rows), 5)

        row = rows["void_branch_and_leg_floors"]
        vault = Vault()
        vault.split(row["inputs"]["branch_amount"])
        vault.split_scalar(
            Branch.ACCEPT, row["inputs"]["scalar_leg_amount"]
        )
        vault.void()
        self.assertEqual(
            vault.redeem_void(
                Branch.REJECT,
                PositionKind.BRANCH_USDC,
                row["inputs"]["branch_amount"],
            ),
            row["branch_payout"],
        )
        self.assertEqual(
            vault.redeem_void(
                Branch.ACCEPT,
                PositionKind.LONG,
                row["inputs"]["scalar_leg_amount"],
            ),
            row["leg_payout"],
        )

        row = rows["b5_scalar_fragmentation"]
        vault = _settled_scalar_vault(
            escrow=row["inputs"]["escrow"], score=row["inputs"]["s"]
        )
        self.assertEqual(
            vault.redeem_scalar(
                Branch.ACCEPT, ScalarSide.LONG, row["inputs"]["escrow"]
            ),
            row["long_payout"],
        )
        self.assertEqual(
            [
                vault.redeem_scalar(
                    Branch.ACCEPT,
                    ScalarSide.SHORT,
                    row["inputs"]["escrow"] // 2,
                )
                for _ in range(2)
            ],
            row["short_payouts"],
        )

        row = rows["scalar_pair_exact"]
        vault = _settled_scalar_vault(
            escrow=row["inputs"]["amount"], score=row["inputs"]["s"]
        )
        self.assertEqual(
            vault.redeem_scalar_pair(
                Branch.ACCEPT, row["inputs"]["amount"]
            ),
            row["payout"],
        )

        row = rows["gate_settlement_one_zero"]
        vault = Vault()
        vault.split(1_000)
        vault.split_gate(Branch.ACCEPT, GateType.SURVIVAL, 1_000)
        vault.resolve(Branch.ACCEPT)
        vault.settle_gate(GateType.SURVIVAL, row["inputs"]["outcome"])
        vault.settle_scalar(Decimal("0.5"))
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT,
                GateType.SURVIVAL,
                GateSide.YES,
                row["inputs"]["amount_each"],
            ),
            row["yes_payout"],
        )
        self.assertEqual(
            vault.redeem_gate(
                Branch.ACCEPT,
                GateType.SURVIVAL,
                GateSide.NO,
                row["inputs"]["amount_each"],
            ),
            row["no_payout"],
        )

        row = rows["baseline_scalar_and_pair"]
        baseline = BaselineVault(epoch=row["inputs"]["epoch"])
        baseline.split_baseline(2 * row["inputs"]["amount"])
        baseline.settle_baseline(Decimal(row["inputs"]["s"]))
        self.assertEqual(
            baseline.redeem_baseline(
                ScalarSide.LONG, row["inputs"]["amount"]
            ),
            row["long_payout"],
        )
        self.assertEqual(
            baseline.redeem_baseline_pair(row["inputs"]["amount"]),
            row["pair_payout"],
        )
        self.assertEqual(baseline.fees_charged_total, 0)
        self.assertEqual(baseline.state, BaselineState.SETTLED)

    # -- the generated fee corpus -------------------------------------------

    def test_fee_corpus_rows_are_standalone_and_internally_consistent(self):
        fixture = _fixture()
        scenarios = fixture["ledger_fee_scenarios"]
        self.assertEqual(fixture["schema"], "bleavit.reference-model.v4")
        self.assertEqual(len(scenarios), 11)
        charged_calls = set()
        exempt_calls = set()
        for scenario in scenarios:
            params = scenario["params"]
            # Rule 4: every row carries the inputs needed to replay it
            # standalone — the rate, the waiver threshold, the exempt set and
            # (via `settle_*`) the score each pair fee is computed from.
            self.assertIn("redeem_fee_perbill", params)
            self.assertIn("min_split", params)
            self.assertIn("protocol_accounts", params)
            rate = params["redeem_fee_perbill"]
            min_split = params["min_split"]
            accrued = 0
            scores = {}
            for op in scenario["ops"]:
                if op["op"] == "settle_scalar":
                    scores["scalar"] = Decimal(
                        op["args"]["s"]
                    ) / Decimal(PERBILL_ONE)
                if op["op"] == "settle_baseline":
                    scores["baseline"] = Decimal(
                        op["args"]["s"]
                    ) / Decimal(PERBILL_ONE)
                if "gross" in op:
                    self.assertEqual(op["net"] + op["fee"], op["gross"])
                    self.assertGreaterEqual(op["fee"], 0)
                    self.assertLessEqual(op["fee"], op["gross"])
                    if op["fee"]:
                        charged_calls.add(op["op"])
                    else:
                        exempt_calls.add(op["op"])
                    # Recompute every fee from the row's own inputs — a pair
                    # from its legs per §5.3a(2a), everything else from its
                    # gross. Exempt calls carry no fee to recompute.
                    if op["op"] in (
                        "redeem_scalar_pair",
                        "redeem_baseline_pair",
                    ):
                        family = (
                            "scalar"
                            if op["op"] == "redeem_scalar_pair"
                            else "baseline"
                        )
                        self.assertEqual(
                            op["fee"],
                            redemption_fee_pair(
                                op["args"]["amount"],
                                scores[family],
                                rate,
                                min_split,
                            ),
                            scenario["name"],
                        )
                    elif op["op"] in (
                        "redeem_scalar",
                        "redeem_gate",
                        "redeem_baseline",
                    ) and not params["protocol_accounts"]:
                        self.assertEqual(
                            op["fee"],
                            redemption_fee(op["gross"], rate, min_split),
                            scenario["name"],
                        )
                    accrued += op["fee"]
                if op["op"] == "sweep_redemption_fees":
                    self.assertEqual(op["outcome"]["ok"]["swept"], accrued)
                    accrued = 0
                self.assertEqual(op["fees_accrued_after"], accrued)
            self.assertEqual(scenario["fees_accrued"], accrued)
            self.assertEqual(
                scenario["fees_charged_total"],
                scenario["fees_accrued"] + scenario["fees_swept_total"],
            )
            # 03 §5.3a(4): `RedemptionFeesAccrued` is pallet storage, so a
            # differential comparing only `final_state` must still see it.
            self.assertEqual(
                scenario["final_state"]["redemption_fees_accrued"],
                scenario["fees_accrued"],
            )
            self.assertEqual(
                scenario["initial_state"]["digest"][
                    "redemption_fees_accrued"
                ],
                0,
            )
        self.assertEqual(
            charged_calls,
            {
                "redeem_scalar",
                "redeem_scalar_pair",
                "redeem_gate",
                "redeem_baseline",
                "redeem_baseline_pair",
            },
        )
        self.assertTrue(
            {"redeem", "redeem_void", "merge", "merge_baseline"}.issubset(
                exempt_calls
            )
        )

    # -- 02 §6 contract-v17 event shape -------------------------------------

    def test_fee_corpus_events_carry_the_gross_with_a_trailing_fee(self):
        # 02 §6 rule 1: the pre-existing `amount`/`payout` field keeps its
        # meaning — the GROSS claim value — and `fee` is appended, so a
        # consumer computes `net = payout − fee` and no frozen field moves.
        # Emitting the net there would ship a wrong frozen event.
        fee_bearing = {
            "redeem_scalar": "ScalarRedeemed",
            "redeem_scalar_pair": "ScalarPairRedeemed",
            "redeem_gate": "GateRedeemed",
            "redeem_baseline": "BaselineRedeemed",
            "redeem_baseline_pair": "BaselineRedeemed",
        }
        # Rule 3: these two are exempt and MUST NOT gain a `fee` field.
        exempt = {
            "redeem": "Redeemed",
            "redeem_void": "VoidRedeemed",
            "merge": "Merged",
            "merge_baseline": "BaselineMerged",
        }
        witnessed = set()
        net_differs = 0
        for scenario in _fixture()["ledger_fee_scenarios"]:
            self.assertEqual(scenario["params"]["contract_version"], 17)
            events = {
                index: event
                for index, event in enumerate(
                    scenario["final_state"]["events"]
                )
            }
            emitted = [events[index] for index in sorted(events)]
            cursor = 0
            for op in scenario["ops"]:
                if "err" in op["outcome"]:
                    continue
                if op["op"] not in fee_bearing and op["op"] not in exempt:
                    cursor += 1
                    continue
                event = emitted[cursor]
                cursor += 1
                if op["op"] in fee_bearing:
                    self.assertEqual(event["kind"], fee_bearing[op["op"]])
                    # trailing `fee`, gross immediately before it
                    self.assertEqual(event["fields"][-1], op["fee"])
                    self.assertEqual(event["fields"][-2], op["gross"])
                    # the outcome speaks the same language as the event
                    self.assertEqual(
                        op["outcome"]["ok"]["payout"], op["gross"]
                    )
                    self.assertEqual(op["outcome"]["ok"]["fee"], op["fee"])
                    self.assertEqual(
                        op["outcome"]["ok"]["payout"]
                        - op["outcome"]["ok"]["fee"],
                        op["net"],
                    )
                    witnessed.add(op["op"])
                    if op["net"] != op["gross"]:
                        net_differs += 1
                else:
                    self.assertEqual(event["kind"], exempt[op["op"]])
                    self.assertNotIn("fee", op["outcome"]["ok"])
                    self.assertEqual(op["fee"], 0)
                    # `Merged`/`BaselineMerged` carry `amount`, and the two
                    # exempt redemption events carry the gross payout; either
                    # way no trailing fee exists to be mistaken for one.
                    self.assertIn(
                        op["gross"], event["fields"][1:]
                    )
                    witnessed.add(op["op"])
        # Every fee-bearing and every exempt redemption call is witnessed,
        # and the gross is provably not the net somewhere — otherwise the
        # assertions above would pass on a corpus that emitted the net.
        self.assertEqual(set(fee_bearing) | set(exempt), witnessed)
        self.assertGreater(net_differs, 0)

    # -- the two rules that exist because the model found their absence -----

    def test_pair_is_never_worse_than_leg_by_leg(self):
        # REGRESSION for the finding that produced 03 §5.3a(2a). The pair path
        # is guaranteed to "pay at least what leg-by-leg redemption of the same
        # holdings pays" (PT-7, I-5). Charging `fee(a)` on the combined gross
        # broke that, because the waiver applies per *call*: a leg below the
        # threshold pays nothing while the pair was charged on the whole base.
        # §5.3a(2a) removes the interaction by charging the pair its own legs.
        # The original counterexample is kept verbatim as the witness.
        pair_vault = _settled_scalar_vault(self.RATE, escrow=20_000)
        pair_net = pair_vault.redeem_scalar_pair(Branch.ACCEPT, 20_000)

        leg_vault = _settled_scalar_vault(self.RATE, escrow=20_000)
        legs_net = leg_vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.LONG, 20_000
        ) + leg_vault.redeem_scalar(
            Branch.ACCEPT, ScalarSide.SHORT, 20_000
        )

        self.assertEqual(pair_net, 19_957)
        self.assertEqual(legs_net, 19_957)
        self.assertGreaterEqual(pair_net, legs_net)
        # The superseded rule would have netted the pair 19_940 — 17 less
        # than fragmenting, which made fragmentation the rational strategy.
        self.assertEqual(20_000 - redemption_fee(20_000, self.RATE), 19_940)
        pair_vault.check_conservation()
        leg_vault.check_conservation()

    def test_pair_is_never_worse_than_legs_over_a_grid(self):
        # The §5.3a(2a) claim is `net_pair ≥ net_legs` for EVERY a, s and
        # rate, so verify it rather than trusting it. The mechanism: both
        # sides apply the identical fee function to the identical bases, and
        # `floor(a·s) + floor(a·(1−s)) ≤ a` leaves the pair a gross advantage.
        scores = (
            "0",
            "0.00000001",
            "0.29995",
            "0.5",
            "0.70005",
            "0.999999999",
            "1",
            "0.333333333",
        )
        amounts = (
            1,
            3,
            9_999,
            10_000,
            10_031,
            14_287,
            20_000,
            33_333,
            1_000_000,
            1_000_003,
        )
        rates = (0, 1, self.RATE, 10_000_000, 500_000_000, PERBILL_ONE)
        equalities = 0
        strict = 0
        for raw_score in scores:
            score = Decimal(raw_score)
            for amount in amounts:
                for rate in rates:
                    pair = _settled_scalar_vault(
                        rate, escrow=amount, score=raw_score
                    )
                    pair_net = pair.redeem_scalar_pair(
                        Branch.ACCEPT, amount
                    )
                    legs = _settled_scalar_vault(
                        rate, escrow=amount, score=raw_score
                    )
                    legs_net = legs.redeem_scalar(
                        Branch.ACCEPT, ScalarSide.LONG, amount
                    ) + legs.redeem_scalar(
                        Branch.ACCEPT, ScalarSide.SHORT, amount
                    )
                    self.assertGreaterEqual(
                        pair_net, legs_net, (amount, raw_score, rate)
                    )
                    # The gross is always exactly `a`, at every rate.
                    self.assertEqual(
                        pair_net
                        + redemption_fee_pair(amount, score, rate),
                        amount,
                    )
                    pair.check_conservation()
                    legs.check_conservation()
                    if pair_net == legs_net:
                        equalities += 1
                    else:
                        strict += 1
        # Both sides of the inequality are actually reached, so the assertion
        # above is not vacuously satisfied by one branch.
        self.assertGreater(equalities, 0)
        self.assertGreater(strict, 0)

        # The Baseline pair carries the identical rule.
        for raw_score in ("0.29995", "0.70005", "0.5"):
            for amount in (10_031, 1_000_000, 1_000_003):
                pair = _settled_baseline_vault(
                    self.RATE, escrow=amount, score=raw_score
                )
                legs = _settled_baseline_vault(
                    self.RATE, escrow=amount, score=raw_score
                )
                self.assertGreaterEqual(
                    pair.redeem_baseline_pair(amount),
                    legs.redeem_baseline(ScalarSide.LONG, amount)
                    + legs.redeem_baseline(ScalarSide.SHORT, amount),
                    (amount, raw_score),
                )

    def test_a_gross_of_exactly_min_balance_is_waived_and_nets_in_full(self):
        # REGRESSION for the finding that produced the net-based waiver of
        # 03 §5.3a(2). §7 R-2 and R-4 put `ledger.min_split` and the USDC
        # `min_balance` at the same 10^4. Under the superseded gross-based
        # test `g < min_split`, a gross of exactly `min_balance` cleared the
        # waiver, was charged 30, and netted 9_970 — below `min_balance`, on
        # precisely the R-4 `BelowMinimum` path the waiver exists to remove.
        min_balance = MIN_SPLIT
        self.assertEqual(redemption_fee(min_balance, self.RATE), 0)
        vault = _settled_scalar_vault(
            self.RATE, escrow=min_balance, score="1"
        )
        self.assertEqual(
            vault.redeem_scalar(
                Branch.ACCEPT, ScalarSide.LONG, min_balance
            ),
            min_balance,
        )
        self.assertEqual(vault.fees_charged_total, 0)
        # The whole band the rationale names is now covered: no charged gross
        # can net below `min_balance`, at any rate.
        for rate in (1, self.RATE, 10_000_000, 500_000_000, PERBILL_ONE):
            for gross in range(0, 4 * min_balance):
                fee = redemption_fee(gross, rate)
                if fee:
                    self.assertGreaterEqual(gross - fee, min_balance)
                else:
                    self.assertEqual(gross - fee, gross)
        # The superseded gross-based rule is what fails that sweep.
        self.assertLess(
            min_balance - ((min_balance * self.RATE) // PERBILL_ONE),
            min_balance,
        )


if __name__ == "__main__":
    unittest.main()
